import { File, type FileProps } from '@asyncapi/generator-react-sdk';
import React from 'react';

import { transformSchemaObject } from 'openapi-typescript';
import {
  createPrinter,
  EmitHint,
  NewLineKind,
  NodeFlags,
  factory,
  SyntaxKind,
  addSyntheticLeadingComment,
  TypeAliasDeclaration,
  ParameterDeclaration,
  Node,
} from 'typescript';

type Message = {
  payload?: {
    'x-parser-schema-id'?: string;
  };
}

type Operation = {
  action: 'send' | 'receive';
  summary?: string;
  channel?: {
    messages?: Record<string, Message>;
  };
}

type AsyncAPIDocument = {
  json(): {
    info?: { title?: string };
    components?: { schemas?: Record<string, unknown> };
    operations?: Record<string, Operation>;
  };
}

const printer = createPrinter({ newLine: NewLineKind.LineFeed });

function createSchemaAst(name: string, schema: unknown): TypeAliasDeclaration {
  const schemaNode = transformSchemaObject(schema as Parameters<typeof transformSchemaObject>[0], { ctx: {} as any });
  return factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], name, undefined, schemaNode);
}

function addCommentAst<T extends Node>(decl: T, comment: string): T {
  return addSyntheticLeadingComment(decl, SyntaxKind.MultiLineCommentTrivia, comment, true);
}

function createParameterAst(name: string, message: Message): ParameterDeclaration {
  const payloadType = message?.payload?.['x-parser-schema-id'] ?? 'unknown';
  return factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createIdentifier(name),
    undefined,
    factory.createTypeReferenceNode(factory.createIdentifier(payloadType), undefined),
    undefined,
  );
}

function createOperationAst(name: string, operation: Operation): TypeAliasDeclaration {
  const node = factory.createTypeAliasDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    factory.createIdentifier(name.replace(/^[a-z]/, (m) => m.toUpperCase())),
    undefined,
    factory.createFunctionTypeNode(
      undefined,
      Object.entries(operation.channel?.messages ?? {}).map(([name, message]) => createParameterAst(name, message)),
      factory.createTypeReferenceNode(factory.createIdentifier('Promise'), [
        factory.createKeywordTypeNode(SyntaxKind.VoidKeyword),
      ]),
    ),
  );
  return addCommentAst(node, ` ${operation.summary} `);
}

function printFile(nodes: TypeAliasDeclaration[]): string {
  const sourceFileNode = factory.createSourceFile(nodes, factory.createToken(SyntaxKind.EndOfFileToken), NodeFlags.None);
  return printer.printNode(EmitHint.Unspecified, sourceFileNode, sourceFileNode);
}

function createTypesFile(
  schemas: Record<string, unknown>,
  sendOps: [string, Operation][],
  receiveOps: [string, Operation][],
): string {
  const schemaNodes = Object.entries(schemas).map(([name, schema]) => createSchemaAst(name, schema));
  const sendTypeNodes = sendOps.map(([id, op]) => createOperationAst(id, op));
  const receiveTypeNodes = receiveOps.map(([id, op]) => createOperationAst(id, op));
  return printFile([...schemaNodes, ...sendTypeNodes, ...receiveTypeNodes]);
}

const FileWithChildren = File as React.FC<FileProps & { children?: string }>;

function toFilename(title: string): string {
  return title.toLowerCase().replace(/\bevents\b/g, '').trim().replace(/\s+/g, '-') + '.d.ts';
}

export default function ({ asyncapi }: { asyncapi: AsyncAPIDocument }) {
  const raw = asyncapi.json();
  const filename = toFilename(raw.info?.title ?? 'asyncapi');
  const schemas = raw.components?.schemas ?? {};
  const operations = Object.entries(raw.operations ?? {}) as [string, Operation][];

  const sendOps = operations.filter(([, op]) => op.action === 'send');
  const receiveOps = operations.filter(([, op]) => op.action === 'receive');

  return [
    <FileWithChildren name={filename}>
      {`// Generated — do not edit manually\n\n${createTypesFile(schemas, sendOps, receiveOps)}\n`}
    </FileWithChildren>,
  ];
}
