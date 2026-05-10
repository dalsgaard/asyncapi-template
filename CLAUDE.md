# asyncapi-template

An AsyncAPI Generator template that produces TypeScript types, an SNS publisher client, and SQS handler factories from an AsyncAPI 3.0 spec.

## What it generates

Given a spec with `info.title: Account Service`, the generator produces three files named after the title slug (`account-service`):

| File | From operations | Purpose |
|------|----------------|---------|
| `account-service.d.ts` | all | TypeScript types for all schemas and operations, plus the aggregate client type |
| `account-service-aws-client.ts` | `send` | `createAccountServiceClient(config)` factory that publishes to AWS SNS |
| `account-service-amqp-client.ts` | `send` | `createAccountServiceAmqpClient(config)` factory that publishes via AMQP |
| `account-service-handlers.ts` | `receive` | `create<Name>Handler(callback)` factories that unwrap SQS→SNS envelope |

## Running the generator

```sh
# From the consuming project, referencing published template on GitHub:
asyncapi generate fromTemplate asyncapi/account.aas.yaml github:dalsgaard/asyncapi-template \
  -o asyncapi/generated --force-write --no-interactive

# From inside this repo (uses local template, rebuilds first):
npm run gen
```

The `gen` script runs `tsc` before generating — the generator uses the compiled JS in `template/`, not the TypeScript source in `src/`.

## Spec conventions the template expects

### Operation naming

The `action` property determines which file an operation ends up in:

```yaml
operations:
  sendAccountCreated:   # → client file
    action: send
  receiveCustomerDeleted:  # → handlers file
    action: receive
```

By convention, operation names are prefixed with `send`/`receive` to match their action. The template strips this prefix when deriving parameter and handler names — `sendAccountCreated` → param `accountCreated`, config field `accountCreatedTopicArn`; `receiveCustomerDeleted` → `createCustomerDeletedHandler`. Without the prefix the names still work but become redundant (`sendAccountCreatedTopicArn` etc.).

### SNS Subject (optional)

Add `x-sns-subject` to a message component to include a `Subject` field in the `PublishCommand`:

```yaml
components:
  messages:
    AccountUpdated:
      x-sns-subject: account.updated
```

### Schemas

All schemas under `components.schemas` are emitted as TypeScript types in the `.d.ts` file, using `openapi-typescript` for the conversion. The schema name becomes the type name verbatim.

Operation payload types are resolved via `x-parser-schema-id`, which the AsyncAPI parser sets automatically from the `$ref` target name.

## Generated client usage

```typescript
import { createAccountServiceClient } from './asyncapi/generated/account-service-aws-client';
import type { Account } from './asyncapi/generated/account-service';

const events = createAccountServiceClient({
  accountCreatedTopicArn: process.env.CREATED_TOPIC_ARN!,
  accountUpdatedTopicArn: process.env.UPDATED_TOPIC_ARN!,
  accountDeletedTopicArn: process.env.DELETED_TOPIC_ARN!,
});

await events.sendAccountCreated(account);
```

The factory creates an `SNSClient` internally. The config type (`AccountServiceClientConfig`) has one `*TopicArn` field per `send` operation.

## Generated AMQP client usage

```typescript
import { createAccountServiceAmqpClient } from './asyncapi/generated/account-service-amqp-client';

const events = await createAccountServiceAmqpClient({
  url: 'amqp://localhost',
  exchange: 'account-events',
});

await events.sendAccountCreated(account);
```

The factory is `async` — it calls `amqplib.connect` and `createChannel` internally. Both clients implement the same `AccountServiceClient` type, so they are interchangeable. The consuming project must install `amqplib`.

Routing keys default to the kebab-case operation name with the `send`/`receive` prefix stripped (`sendAccountCreated` → `account-created`). Override per message with `x-amqp-routing-key`:

```yaml
components:
  messages:
    AccountCreated:
      x-amqp-routing-key: accounts.created
```

## Generated handler usage

```typescript
import { createCustomerDeletedHandler } from './asyncapi/generated/account-service-handlers';

export const handler = createCustomerDeletedHandler(async ({ id }) => {
  // id is typed from the CustomerDeleted schema
});
```

Each factory wraps an SQS handler that parses the SQS→SNS→JSON envelope and calls the callback once per record.

## Template structure

```
src/                  TypeScript source (edit here)
  create-types.tsx    → <slug>.d.ts
  create-client.tsx        → <slug>-aws-client.ts
  create-amqp-client.tsx   → <slug>-amqp-client.ts
  create-handlers.tsx      → <slug>-handlers.ts
template/             Compiled JS (committed — generator reads this from GitHub)
examples/             Sample specs used by gen
```

## Development

```sh
npm run build       # compile src/ → template/
npm run typecheck   # type-check without emitting
npm run gen        # build + generate from all examples/*.aas.yaml
```

After changes, commit both `src/` and `template/` so GitHub-based consumers pick up the new compiled output immediately.

> **Note:** The generator never deletes old output files. If a generated filename changes (e.g. a template rename), manually delete the stale file from the output directory in both this repo (`generated/`) and any consuming project.
