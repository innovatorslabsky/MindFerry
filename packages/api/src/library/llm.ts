import { Providers, initializeModel } from '@librechat/agents';
import { EModelEndpoint, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { ClientOptions } from '@librechat/agents';
import type { EndpointDbMethods, OpenAIConfiguration, ServerRequest } from '~/types';
import { getBalanceConfig, getTransactionsConfig } from '~/app/config';
import { getProviderConfig } from '~/endpoints/config/providers';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { resolveConfigHeaders } from '~/utils/headers';
import { omitTitleOptions } from '~/agents/client';
import { createSafeUser } from '~/utils/env';

/** A summary is a few hundred tokens; this stops a model that ignores the length asked for. */
const MAX_OUTPUT_TOKENS = 1024;
/** Longest the library waits for a model before giving up on a summary. */
const TIMEOUT_MS = 90_000;

export class LibraryModelError extends Error {
  constructor(
    readonly code: 'model_unavailable' | 'insufficient_balance' | 'empty_completion',
    message: string,
  ) {
    super(message);
    this.name = 'LibraryModelError';
  }
}

export interface LibraryTextRequest {
  endpoint: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
  /**
   * Whether the call is spent against the person's balance, and refused when they have none left.
   * On unless the deployment pays for the model.
   */
  chargeUser?: boolean;
}

/** Runs a one-shot prompt on the endpoint and model the person picked, with their own credentials. */
export type LibraryTextGenerator = (
  req: ServerRequest,
  request: LibraryTextRequest,
) => Promise<string>;

export interface LibraryTextGeneratorDeps {
  db: EndpointDbMethods & {
    spendTokens: (
      txData: Record<string, unknown>,
      usage: { promptTokens?: number; completionTokens?: number },
    ) => Promise<unknown>;
    findBalanceByUser: (user: string) => Promise<{ tokenCredits?: number } | null>;
  };
}

type MaybeAzureConfig = ClientOptions & {
  azureOpenAIApiInstanceName?: string;
  configuration?: OpenAIConfiguration;
};

/** The primary-generation options a one-shot call must not inherit, minus the client carrier. */
const OMIT = new Set([...omitTitleOptions].filter((key) => key !== 'clientOptions'));

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === 'string' ? block : ((block as { text?: string })?.text ?? ''),
      )
      .join('')
      .trim();
  }
  return '';
}

async function resolve(
  req: ServerRequest,
  { endpoint, model }: Pick<LibraryTextRequest, 'endpoint' | 'model'>,
  db: EndpointDbMethods,
): Promise<{ provider: Providers; clientOptions: ClientOptions }> {
  if (isAgentsEndpoint(endpoint) || isAssistantsEndpoint(endpoint)) {
    throw new LibraryModelError('model_unavailable', 'This endpoint cannot write a summary');
  }
  const appConfig = req.config as AppConfig | undefined;
  let providerConfig;
  try {
    providerConfig = getProviderConfig({ provider: endpoint, appConfig });
  } catch {
    throw new LibraryModelError('model_unavailable', 'Unknown endpoint');
  }
  const options = await providerConfig.getOptions({
    req,
    endpoint,
    model_parameters: { model },
    db,
  });
  const llmConfig = options.llmConfig as MaybeAzureConfig | undefined;
  let provider = (options.provider ?? providerConfig.overrideProvider) as Providers;
  if (endpoint === EModelEndpoint.azureOpenAI) {
    provider = llmConfig?.azureOpenAIApiInstanceName == null ? Providers.OPENAI : Providers.AZURE;
  }

  const raw = { ...(llmConfig ?? {}) } as MaybeAzureConfig & {
    maxTokens?: number;
    modelKwargs?: Record<string, unknown>;
  };
  delete raw.maxTokens;
  if (raw.modelKwargs != null) {
    const modelKwargs = { ...raw.modelKwargs };
    delete modelKwargs.max_completion_tokens;
    delete modelKwargs.max_output_tokens;
    raw.modelKwargs = modelKwargs;
  }
  const clientOptions = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !OMIT.has(key)),
  ) as MaybeAzureConfig & { modelKwargs?: Record<string, unknown> };

  const gpt5Plus = /\bgpt-[5-9](?:\.\d+)?\b/i.test(model);
  const oSeries = /\bo[1-9](?:[-.]|\b)/i.test(model);
  if (provider === Providers.GOOGLE || provider === Providers.VERTEXAI) {
    (clientOptions as { maxOutputTokens?: number }).maxOutputTokens = MAX_OUTPUT_TOKENS;
  } else if (gpt5Plus) {
    const name = (raw as { useResponsesApi?: boolean }).useResponsesApi
      ? 'max_output_tokens'
      : 'max_completion_tokens';
    clientOptions.modelKwargs = { ...(clientOptions.modelKwargs ?? {}), [name]: MAX_OUTPUT_TOKENS };
  } else if (!oSeries) {
    (clientOptions as { maxTokens?: number }).maxTokens = MAX_OUTPUT_TOKENS;
  }
  if (options.configOptions) {
    clientOptions.configuration = options.configOptions;
  }
  resolveConfigHeaders({
    llmConfig: clientOptions,
    user: createSafeUser(req.user as IUser | undefined),
    tenantId: resolveRequestTenantId(req),
    body: {},
  });
  return { provider, clientOptions: clientOptions as ClientOptions };
}

/**
 * Spending is recorded after the call, against the person's balance when balances are on. A person
 * with no credits left is turned away first; there is no reservation, so one call can overdraw by
 * the cost of a single summary.
 */
export function createLibraryTextGenerator({ db }: LibraryTextGeneratorDeps): LibraryTextGenerator {
  return async (req, request) => {
    const appConfig = req.config as AppConfig | undefined;
    const userId = req.user?.id;
    const balance = getBalanceConfig(appConfig);
    const charge = request.chargeUser !== false;
    if (charge && userId && balance?.enabled) {
      const record = await db.findBalanceByUser(userId);
      if ((record?.tokenCredits ?? 0) <= 0) {
        throw new LibraryModelError('insufficient_balance', 'No credits left');
      }
    }

    const { provider, clientOptions } = await resolve(req, request, db);
    const model = initializeModel({
      provider,
      clientOptions: { ...clientOptions, streaming: false } as ClientOptions,
    });
    const signal = request.signal
      ? AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS);
    const response = (await (
      model as {
        invoke: (
          input: string,
          config?: object,
        ) => Promise<{
          content?: unknown;
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
        }>;
      }
    ).invoke(request.prompt, { signal })) as {
      content?: unknown;
      usage_metadata?: { input_tokens?: number; output_tokens?: number };
    };

    const usage = response.usage_metadata;
    if (charge && userId && usage) {
      await db
        .spendTokens(
          {
            user: userId,
            model: request.model,
            context: 'library-summary',
            balance,
            transactions: getTransactionsConfig(appConfig),
          },
          { promptTokens: usage.input_tokens, completionTokens: usage.output_tokens },
        )
        .catch(() => undefined);
    }

    const text = textOf(response.content);
    if (!text) {
      throw new LibraryModelError('empty_completion', 'The model returned no text');
    }
    return text;
  };
}
