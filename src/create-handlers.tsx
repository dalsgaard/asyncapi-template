import { File, type FileProps } from '@asyncapi/generator-react-sdk';
import React from 'react';

const FileWithChildren = File as React.FC<FileProps & { children?: string }>;

type Operation = {
  action: 'send' | 'receive';
  summary?: string;
}

type AsyncAPIDocument = {
  json(): {
    info?: { title?: string };
    operations?: Record<string, Operation>;
  };
}

function toPascalCase(str: string): string {
  return str.replace(/^[a-z]/, (m) => m.toUpperCase());
}

function stripActionPrefix(name: string): string {
  return name.replace(/^(send|receive)/i, '');
}

function toSlug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, '-');
}

function toModuleName(title: string): string {
  return './' + toSlug(title);
}

function generateFile(receiveOps: [string, Operation][], typesModule: string): string {
  const typeNames = receiveOps.map(([name]) => toPascalCase(name));

  const lines: string[] = [
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
    if (op.summary) lines.push(`/** ${op.summary} */`);
    lines.push(`export const create${handlerName}Handler = createHandler<${typeName}>`);
    lines.push(``);
  }

  return lines.join('\n');
}

export default function ({ asyncapi }: { asyncapi: AsyncAPIDocument }) {
  const raw = asyncapi.json();
  const typesModule = toModuleName(raw.info?.title ?? 'asyncapi');
  const operations = Object.entries(raw.operations ?? {}) as [string, Operation][];
  const receiveOps = operations.filter(([, op]) => op.action === 'receive');

  if (receiveOps.length === 0) return [];

  const filename = toSlug(raw.info?.title ?? 'asyncapi') + '-handlers.ts';

  return [
    <FileWithChildren name={filename}>
      {`// Generated — do not edit manually\n\n${generateFile(receiveOps, typesModule)}`}
    </FileWithChildren>,
  ];
}
