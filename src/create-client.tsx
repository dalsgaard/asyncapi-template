import { File, type FileProps } from '@asyncapi/generator-react-sdk';
import React from 'react';

const FileWithChildren = File as React.FC<FileProps & { children?: string }>;

type Message = {
  'x-sns-subject'?: string;
}

type Operation = {
  action: 'send' | 'receive';
  channel?: {
    messages?: Record<string, Message>;
  };
}

type AsyncAPIDocument = {
  json(): {
    info?: { title?: string };
    operations?: Record<string, Operation>;
  };
}

function toSlug(title: string): string {
  return title.toLowerCase().replace(/\bevents\b/g, '').trim().replace(/\s+/g, '-');
}

function slugToPascalCase(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function toPascalCase(str: string): string {
  return str.replace(/^[a-z]/, (m) => m.toUpperCase());
}

function stripActionPrefix(name: string): string {
  return name.replace(/^(send|receive)/i, '');
}

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function getSnsSubject(op: Operation): string | undefined {
  return Object.values(op.channel?.messages ?? {})[0]?.['x-sns-subject'];
}

function generateFile(slug: string, sendOps: [string, Operation][], typesModule: string): string {
  const clientType = slugToPascalCase(slug) + 'Client';
  const configType = slugToPascalCase(slug) + 'ClientConfig';
  const typeNames = sendOps.map(([name]) => toPascalCase(name));

  const configFields = sendOps.map(([name]) => {
    const stripped = stripActionPrefix(name);
    return `  ${toCamelCase(stripped)}TopicArn: string;`;
  });

  const lines: string[] = [
    `import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";`,
    `import { ${typeNames.join(', ')} } from "${typesModule}";`,
    ``,
    `export type ${configType} = {`,
    ...configFields,
    `};`,
    ``,
    `export type ${clientType} = {`,
    ...sendOps.map(([name]) => `  ${name}: ${toPascalCase(name)};`),
    `};`,
    ``,
    `export function create${clientType}(sns: SNSClient, config: ${configType}): ${clientType} {`,
    `  return {`,
  ];

  for (const [name, op] of sendOps) {
    const stripped = stripActionPrefix(name);
    const param = toCamelCase(stripped);
    const configField = `${toCamelCase(stripped)}TopicArn`;
    const subject = getSnsSubject(op);

    lines.push(`    ${name}: async (${param}) => {`);
    lines.push(`      await sns.send(new PublishCommand({`);
    lines.push(`        TopicArn: config.${configField},`);
    lines.push(`        Message: JSON.stringify(${param}),`);
    if (subject) lines.push(`        Subject: '${subject}',`);
    lines.push(`      }));`);
    lines.push(`    },`);
  }

  lines.push(`  };`);
  lines.push(`}`);
  lines.push(``);

  return lines.join('\n');
}

export default function ({ asyncapi }: { asyncapi: AsyncAPIDocument }) {
  const raw = asyncapi.json();
  const slug = toSlug(raw.info?.title ?? 'asyncapi');
  const operations = Object.entries(raw.operations ?? {}) as [string, Operation][];
  const sendOps = operations.filter(([, op]) => op.action === 'send');

  if (sendOps.length === 0) return [];

  return [
    <FileWithChildren name={`${slug}-client.ts`}>
      {`// Generated — do not edit manually\n\n${generateFile(slug, sendOps, `./${slug}`)}`}
    </FileWithChildren>,
  ];
}
