const multer = require('multer');
const express = require('express');
const { CLIENT_MESSAGE_SELECT } = require('@librechat/data-schemas');
const { PermissionTypes, Permissions } = require('librechat-data-provider');
const {
  createContextHubMcpHandler,
  createContextHubImportHandler,
  createContextHubArchiveHandler,
  createContextHubContinueHandler,
  createContextHubNoteContinueHandler,
  createHubListThreadsHandler,
  createHubGetThreadHandler,
  createHubListNotesHandler,
  contextHubMcpLimiter,
  contextHubImportLimiter,
  contextHubArchiveLimiter,
  contextHubBrowseLimiter,
  createRequireApiKeyAuth,
  resolveImportMaxFileSize,
  attachHubOAuthWwwAuthenticate,
  createHubOAuthRegisterHandler,
  createHubOAuthAuthorizeHandler,
  createHubOAuthConsentHandler,
  createHubOAuthTokenHandler,
  hubOAuthRegisterLimiter,
  hubOAuthTokenLimiter,
  requireHubMcpEnabled,
  generateCheckAccess,
  restoreTenantContextFromReq,
} = require('@librechat/api');
const { storage, importFileFilter } = require('~/server/routes/files/multer');
const { configMiddleware, requireJwtAuth } = require('~/server/middleware');
const { importHubConversation } = require('~/server/utils/import/hub');
const db = require('~/models');

const router = express.Router();

/**
 * Authenticates the same way Remote Agent event ingestion does: a hashed,
 * expiring, per-user API key minted at `/api/api-keys`, gated behind the
 * REMOTE_AGENTS role permission. A caller that can already push agent
 * trigger events under this key can also reach their own hub archive under
 * it — one bearer credential, one principal, multiple capabilities for that
 * principal, rather than a second key type that would just duplicate this
 * hashed-storage and validation code for no additional isolation (nothing
 * here trusts the key with another user's data either way).
 */
const apiKeyMiddleware = createRequireApiKeyAuth({
  validateAgentApiKey: db.validateAgentApiKey,
  findUser: db.findUser,
  isPrincipalActive: db.isAgentTriggerPrincipalActive,
});

const mcpHandler = createContextHubMcpHandler({
  methods: db,
  importConversation: importHubConversation,
  clientOrigin: process.env.DOMAIN_CLIENT,
});

/**
 * `configMiddleware` runs after `apiKeyMiddleware` because it derives
 * `req.config` from `req.user`, and the rate limiter runs after both so it
 * can key its window by the authenticated user rather than by IP.
 */
router.all(
  '/mcp',
  attachHubOAuthWwwAuthenticate,
  apiKeyMiddleware,
  configMiddleware,
  contextHubMcpLimiter,
  mcpHandler,
);

/**
 * The upload of a user's own export, through the LibreChat UI — an ordinary
 * session (`requireJwtAuth`), not the API-key path the MCP endpoint above
 * uses. `configMiddleware` runs before `multer` because its disk-storage
 * destination reads `req.config.paths.uploads`. Reuses the same disk storage
 * and JSON-only filter `/api/convos/import` already uses, and the same
 * env-configured size ceiling, since this is the same class of upload.
 */
const uploadSingle = multer({
  storage,
  fileFilter: importFileFilter,
  limits: { fileSize: resolveImportMaxFileSize() },
}).single('file');

function handleImportUpload(req, res, next) {
  uploadSingle(req, res, (err) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: {
          message: 'File exceeds the maximum allowed size',
          type: 'invalid_request_error',
          code: 'file_too_large',
        },
      });
    }
    if (err) {
      return next(err);
    }
    next();
  });
}

const importHandler = createContextHubImportHandler({ methods: db });

router.post(
  '/import',
  requireJwtAuth,
  configMiddleware,
  contextHubImportLimiter,
  handleImportUpload,
  importHandler,
);

/**
 * "Save to MindFerry" for a conversation the user already owns —
 * converts it directly rather than round-tripping through an export file.
 */
const archiveHandler = createContextHubArchiveHandler({
  methods: db,
  getConvo: db.getConvo,
  getMessages: (params) => db.getMessages(params, CLIENT_MESSAGE_SELECT),
});

router.post(
  '/archive/:conversationId',
  requireJwtAuth,
  configMiddleware,
  contextHubArchiveLimiter,
  archiveHandler,
);

/**
 * Read-only browsing of the archive from MindFerry's own UI — for a person
 * who wants to look at what's in the hub without going through an AI client.
 */
const listThreadsHandler = createHubListThreadsHandler({
  methods: db,
  findLiveConversationIds: async (userId, conversationIds) => {
    const { conversations } = await db.getConvosQueried(
      userId,
      conversationIds.map((conversationId) => ({ conversationId })),
      null,
      conversationIds.length,
    );
    return conversations.map((conversation) => conversation.conversationId);
  },
});
const getThreadHandler = createHubGetThreadHandler({ methods: db });
const listNotesHandler = createHubListNotesHandler({ methods: db });

router.get(
  '/threads',
  requireJwtAuth,
  configMiddleware,
  contextHubBrowseLimiter,
  listThreadsHandler,
);
router.get(
  '/threads/:id',
  requireJwtAuth,
  configMiddleware,
  contextHubBrowseLimiter,
  getThreadHandler,
);
/**
 * "Continue in chat": opens an archived thread as an ordinary conversation,
 * through the same importer a conversation file goes through.
 */
const continueHandler = createContextHubContinueHandler({
  methods: db,
  importConversation: importHubConversation,
});

router.post(
  '/threads/:id/continue',
  requireJwtAuth,
  configMiddleware,
  restoreTenantContextFromReq,
  contextHubArchiveLimiter,
  continueHandler,
);
router.get('/notes', requireJwtAuth, configMiddleware, contextHubBrowseLimiter, listNotesHandler);

/** "Continue in chat" for a note: a new conversation that starts from the note, through the same importer. */
const noteContinueHandler = createContextHubNoteContinueHandler({
  methods: db,
  importConversation: importHubConversation,
});

router.post(
  '/notes/:id/continue',
  requireJwtAuth,
  configMiddleware,
  restoreTenantContextFromReq,
  contextHubArchiveLimiter,
  noteContinueHandler,
);

/**
 * OAuth 2.1 authorization server for the MCP endpoint above — required
 * because Claude.ai's "Add custom connector" dialog takes only a name and a
 * URL, with no field for a pre-shared credential; it discovers this flow via
 * the `WWW-Authenticate` header a 401 from `/mcp` now carries. `/register`
 * and `/token` are reachable without a LibreChat session by design (see
 * their handlers); `/authorize` only validates and redirects to the SPA's
 * consent page; `/consent` is where an authenticated decision actually
 * happens, gated by the same REMOTE_AGENTS permission the API-keys route
 * uses, since approving here mints the same kind of key. Every route is
 * also gated behind `requireHubMcpEnabled`, same as `/mcp` above — the OAuth
 * server exists only to authorize access to that endpoint, so it goes dark
 * with it.
 */
const checkRemoteAgentsUse = generateCheckAccess({
  permissionType: PermissionTypes.REMOTE_AGENTS,
  permissions: [Permissions.USE],
  getRoleByName: db.getRoleByName,
});

router.post(
  '/oauth/register',
  configMiddleware,
  requireHubMcpEnabled,
  hubOAuthRegisterLimiter,
  createHubOAuthRegisterHandler({ methods: db }),
);

router.get(
  '/oauth/authorize',
  configMiddleware,
  requireHubMcpEnabled,
  createHubOAuthAuthorizeHandler({ methods: db }),
);

router.post(
  '/oauth/consent',
  requireJwtAuth,
  configMiddleware,
  requireHubMcpEnabled,
  checkRemoteAgentsUse,
  createHubOAuthConsentHandler({ methods: db }),
);

router.post(
  '/oauth/token',
  configMiddleware,
  requireHubMcpEnabled,
  hubOAuthTokenLimiter,
  createHubOAuthTokenHandler({ methods: db }),
);

module.exports = router;
