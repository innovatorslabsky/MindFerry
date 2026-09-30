const { getImporter } = require('./importers');
const { createImportBatchBuilder } = require('./importBatchBuilder');

/**
 * Runs a hub thread, already converted to LibreChat's conversation shape,
 * through the app's own importer — so it gets the same content filters, size
 * limits and default model as any other import — and returns the id of the
 * conversation that was created.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.userRole]
 * @param {object} params.payload - `HubContinueImport` from `@librechat/api`.
 * @param {import('express').Request} params.req - Supplies the request's runtime config.
 * @returns {Promise<{ conversationId: string }>}
 */
async function importHubConversation({ userId, userRole, payload, req }) {
  const { interfaceConfig, filters, messageFilter } = req.config ?? {};
  let batch;
  await getImporter(payload)(
    payload,
    userId,
    (requestUserId) => {
      batch =
        messageFilter?.pii == null
          ? createImportBatchBuilder(requestUserId, interfaceConfig, filters)
          : createImportBatchBuilder(requestUserId, interfaceConfig, filters, messageFilter.pii);
      return batch;
    },
    userRole,
  );
  return { conversationId: batch.conversationId };
}

module.exports = { importHubConversation };
