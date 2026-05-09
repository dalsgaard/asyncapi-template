# asyncapi-template

An [AsyncAPI Generator](https://www.asyncapi.com/tools/generator) template that produces TypeScript types, an SNS publisher client, and SQS handler factories from an AsyncAPI 3.0 spec.

## Generated output

Given a spec with `info.title: Account Service`, three files are generated using the title slug (`account-service`):

| File | Purpose |
|------|---------|
| `account-service.d.ts` | TypeScript types for all schemas and operations |
| `account-service-aws-client.ts` | `createAccountServiceClient(config)` — publishes to SNS |
| `account-service-handlers.ts` | `create<Name>Handler(callback)` — unwraps SQS→SNS envelope |

## Usage

```sh
asyncapi generate fromTemplate asyncapi/my-service.aas.yaml github:dalsgaard/asyncapi-template \
  -o asyncapi/generated --force-write --no-interactive
```

### Client

```typescript
import { createAccountServiceClient } from './asyncapi/generated/account-service-aws-client';

const events = createAccountServiceClient({
  accountCreatedTopicArn: process.env.CREATED_TOPIC_ARN!,
  accountUpdatedTopicArn: process.env.UPDATED_TOPIC_ARN!,
  accountDeletedTopicArn: process.env.DELETED_TOPIC_ARN!,
});

await events.sendAccountCreated(account);
```

### Handlers

```typescript
import { createCustomerDeletedHandler } from './asyncapi/generated/account-service-handlers';

export const handler = createCustomerDeletedHandler(async ({ id }) => {
  // id is typed from the CustomerDeleted schema
});
```

## Spec conventions

### Operation naming

The `action` property determines which file an operation ends up in:

```yaml
operations:
  sendAccountCreated:       # action: send → client file
    action: send
  receiveCustomerDeleted:   # action: receive → handlers file
    action: receive
```

By convention, operation names are prefixed with `send`/`receive` to match their action. The template strips this prefix when deriving parameter and handler names, so `sendAccountCreated` produces `accountCreatedTopicArn` and `receiveCustomerDeleted` produces `createCustomerDeletedHandler`.

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
