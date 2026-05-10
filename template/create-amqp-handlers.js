import { jsx as _jsx } from "react/jsx-runtime";
import { File } from '@asyncapi/generator-react-sdk';
const FileWithChildren = File;
function toSlug(title) {
    return title.toLowerCase().replace(/\s+/g, '-');
}
function toPascalCase(str) {
    return str.replace(/^[a-z]/, (m) => m.toUpperCase());
}
function stripActionPrefix(name) {
    return name.replace(/^(send|receive)/i, '');
}
function toKebabCase(str) {
    return str.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '');
}
function getPayloadType(op) {
    return Object.values(op.channel?.messages ?? {})[0]?.payload?.['x-parser-schema-id'] ?? 'unknown';
}
function getRoutingKey(op, opName) {
    return Object.values(op.channel?.messages ?? {})[0]?.['x-amqp-routing-key']
        ?? toKebabCase(stripActionPrefix(opName));
}
function generateListener(opName, op, exchange) {
    const name = toPascalCase(stripActionPrefix(opName));
    const payloadType = getPayloadType(op);
    const routingKey = getRoutingKey(op, opName);
    const exchangeArg = exchange ? `"${exchange}"` : 'config.exchange';
    const lines = [];
    if (op.summary)
        lines.push(`/** ${op.summary} */`);
    lines.push(`export async function create${name}AmqpListener(config: AmqpListenerConfig, callback: (message: ${payloadType}) => Promise<void>): Promise<{ close(): Promise<void> }> {`);
    lines.push(`  const connection = await amqplib.connect(config.url);`);
    lines.push(`  const channel = await connection.createChannel();`);
    lines.push(`  await channel.assertExchange(${exchangeArg}, "topic", { durable: true });`);
    lines.push(`  await channel.assertQueue(config.queue, { durable: true });`);
    lines.push(`  await channel.bindQueue(config.queue, ${exchangeArg}, "${routingKey}");`);
    lines.push(`  channel.consume(config.queue, async (msg) => {`);
    lines.push(`    if (!msg) return;`);
    lines.push(`    await callback(JSON.parse(msg.content.toString()));`);
    lines.push(`    channel.ack(msg);`);
    lines.push(`  });`);
    lines.push(`  return { close: async () => { await connection.close(); } };`);
    lines.push(`}`);
    return lines.join('\n');
}
function generateFile(receiveOps, exchange, typesModule) {
    const payloadTypes = [...new Set(receiveOps.map(([, op]) => getPayloadType(op)))];
    const exchangeProp = exchange === undefined ? `  exchange: string;\n` : '';
    return [
        `import amqplib from "amqplib";`,
        `import type { ${payloadTypes.join(', ')} } from "${typesModule}";`,
        ``,
        `export type AmqpListenerConfig = {`,
        `  url: string;`,
        `${exchangeProp}  queue: string;`,
        `};`,
        ``,
        ...receiveOps.map(([name, op]) => generateListener(name, op, exchange)),
    ].join('\n');
}
export default function ({ asyncapi }) {
    const raw = asyncapi.json();
    const slug = toSlug(raw.info?.title ?? 'asyncapi');
    const exchange = raw.info?.['x-amqp-exchange'];
    const operations = Object.entries(raw.operations ?? {});
    const receiveOps = operations.filter(([, op]) => op.action === 'receive');
    if (receiveOps.length === 0)
        return [];
    return [
        _jsx(FileWithChildren, { name: `${slug}-amqp-handlers.ts`, children: `// Generated — do not edit manually\n\n${generateFile(receiveOps, exchange, `./${slug}`)}` }),
    ];
}
