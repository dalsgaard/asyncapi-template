import { jsx as _jsx } from "react/jsx-runtime";
import { File } from '@asyncapi/generator-react-sdk';
const FileWithChildren = File;
function toPascalCase(str) {
    return str.replace(/^[a-z]/, (m) => m.toUpperCase());
}
function stripActionPrefix(name) {
    return name.replace(/^(send|receive)/i, '');
}
function toSlug(title) {
    return title.toLowerCase().replace(/\s+/g, '-');
}
function toModuleName(title) {
    return './' + toSlug(title);
}
function generateFile(receiveOps, typesModule) {
    const typeNames = receiveOps.map(([name]) => toPascalCase(name));
    const lines = [
        `import { SQSEvent } from "aws-lambda";`,
        `import { ${typeNames.join(', ')} } from "${typesModule}";`,
        ``,
        `type Handler = (event: SQSEvent) => Promise<void>;`,
        `type Callback<T> = (message: T) => Promise<void>;`,
        ``,
        `export function createHandler<T extends Callback<Parameters<T>[0]>>(callback: T): Handler {`,
        `  return async (event) => {`,
        `    for (const record of event.Records) {`,
        `      const sns = JSON.parse(record.body);`,
        `      await callback(JSON.parse(sns.Message));`,
        `    }`,
        `  }`,
        `}`,
        ``,
    ];
    for (const [name, op] of receiveOps) {
        const typeName = toPascalCase(name);
        const handlerName = toPascalCase(stripActionPrefix(name));
        if (op.summary)
            lines.push(`/** ${op.summary} */`);
        lines.push(`export const create${handlerName}Handler = createHandler<${typeName}>`);
        lines.push(``);
    }
    return lines.join('\n');
}
export default function ({ asyncapi }) {
    const raw = asyncapi.json();
    const typesModule = toModuleName(raw.info?.title ?? 'asyncapi');
    const operations = Object.entries(raw.operations ?? {});
    const receiveOps = operations.filter(([, op]) => op.action === 'receive');
    if (receiveOps.length === 0)
        return [];
    const filename = toSlug(raw.info?.title ?? 'asyncapi') + '-aws-handlers.ts';
    return [
        _jsx(FileWithChildren, { name: filename, children: `// Generated — do not edit manually\n\n${generateFile(receiveOps, typesModule)}` }),
    ];
}
