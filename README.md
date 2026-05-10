# asyncapi-template

An [AsyncAPI Generator](https://www.asyncapi.com/tools/generator) template that produces TypeScript types, an SNS publisher client, an AMQP publisher client, SQS handler factories, and AMQP listener factories from an AsyncAPI 3.0 spec.

## Generated output

Given a spec with `info.title: Account Service`, five files are generated using the title slug (`account-service`):

| File | Purpose |
|------|---------|
| `account-service.d.ts` | TypeScript types for all schemas and operations |
| `account-service-aws-client.ts` | `createAccountServiceClient(config)` — publishes to AWS SNS |
| `account-service-amqp-client.ts` | `createAccountServiceAmqpClient(config)` — publishes via AMQP |
| `account-service-handlers.ts` | `create<Name>Handler(callback)` — unwraps SQS→SNS envelope |
| `account-service-amqp-listeners.ts` | `create<Name>AmqpListener(config, callback)` — consumes from AMQP |

## Usage

```sh
asyncapi generate fromTemplate asyncapi/my-service.aas.yaml github:dalsgaard/asyncapi-template \
  -o asyncapi/generated --force-write --no-interactive
```

### AWS SNS client

```typescript
import { createAccountServiceClient } from './asyncapi/generated/account-service-aws-client';

const events = createAccountServiceClient({
  accountCreatedTopicArn: process.env.CREATED_TOPIC_ARN!,
  accountUpdatedTopicArn: process.env.UPDATED_TOPIC_ARN!,
  accountDeletedTopicArn: process.env.DELETED_TOPIC_ARN!,
});

await events.sendAccountCreated(account);
```

### AMQP client

```typescript
import { createAccountServiceAmqpClient } from './asyncapi/generated/account-service-amqp-client';

const events = await createAccountServiceAmqpClient({
  url: 'amqp://localhost',
});

await events.sendAccountCreated(account);
await events.close();
```

The factory is `async` and uses publisher confirms — `sendX` only resolves once the broker has acknowledged the message. Both clients implement the same `AccountServiceClient` type and are interchangeable. The consuming project must install `amqplib`.

### SQS handlers

```typescript
import { createCustomerDeletedHandler } from './asyncapi/generated/account-service-handlers';

export const handler = createCustomerDeletedHandler(async ({ id }) => {
  // id is typed from the CustomerDeleted schema
});
```

### AMQP listeners

```typescript
import { createCustomerDeletedAmqpListener } from './asyncapi/generated/account-service-amqp-listeners';

const listener = await createCustomerDeletedAmqpListener(
  { url: 'amqp://localhost', queue: 'my-service' },
  async ({ id }) => {
    // id is typed from the CustomerDeleted schema
  },
);

process.on('SIGINT', async () => { await listener.close(); process.exit(0); });
```

Each listener asserts the exchange and queue, binds with the correct routing key, and begins consuming. The `queue` name is runtime config — different consumers use different queue names so each gets its own copy of the message.

## Spec conventions

### Operation naming

The `action` property determines which files an operation ends up in:

```yaml
operations:
  sendAccountCreated:       # action: send → aws-client + amqp-client
    action: send
  receiveCustomerDeleted:   # action: receive → handlers + amqp-listeners
    action: receive
```

By convention, operation names are prefixed with `send`/`receive` to match their action. The template strips this prefix when deriving names, so `sendAccountCreated` produces `accountCreatedTopicArn` and `receiveCustomerDeleted` produces `createCustomerDeletedHandler` / `createCustomerDeletedAmqpListener`.

### AMQP exchange (optional)

Add `x-amqp-exchange` to the `info` block to bake the exchange name into the generated code — it will be emitted as a string literal and omitted from the config. Without it, `exchange` is a required config field:

```yaml
info:
  title: Account Service
  x-amqp-exchange: account-events
```

### AMQP routing keys

Routing keys default to the kebab-case operation name minus the `send`/`receive` prefix (`sendAccountCreated` → `account-created`). Override per message with `x-amqp-routing-key`:

```yaml
components:
  messages:
    AccountCreated:
      x-amqp-routing-key: accounts.created
```

### SNS Subject (optional)

Add `x-sns-subject` to a message to include a `Subject` in the SNS publish call:

```yaml
components:
  messages:
    AccountUpdated:
      x-sns-subject: account.updated
```

### Schemas

All schemas under `components.schemas` are emitted as TypeScript types using [openapi-typescript](https://openapi-ts.dev).

## Development

Requires Node.js (Unix/macOS).

```sh
npm install
npm run build       # compile src/ → template/
npm run typecheck   # type-check without emitting
npm run gen         # build + generate from all examples/*.aas.yaml
```

Template source lives in `src/` (TypeScript). The generator reads compiled output from `template/` — both are committed so GitHub-based consumers always have up-to-date JS without a separate build step.
