import { File, type FileProps } from '@asyncapi/generator-react-sdk';
import React from 'react';
import {
  createPrinter,
  EmitHint,
  NewLineKind,
  NodeFlags,
  factory,
  SyntaxKind,
  type Statement,
} from 'typescript';

const FileWithChildren = File as React.FC<FileProps & { children?: string }>;
const printer = createPrinter({ newLine: NewLineKind.LineFeed });

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
  return title.toLowerCase().replace(/\s+/g, '-');
}

function slugToPascalCase(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
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

function buildImports(typeNames: string[], typesModule: string): Statement[] {
  const namedImport = (name: string) =>
    factory.createImportSpecifier(false, undefined, factory.createIdentifier(name));

  return [
    factory.createImportDeclaration(
      undefined,
      factory.createImportClause(false, undefined, factory.createNamedImports([
        namedImport('SNSClient'),
        namedImport('PublishCommand'),
      ])),
      factory.createStringLiteral('@aws-sdk/client-sns'),
    ),
    factory.createImportDeclaration(
      undefined,
      factory.createImportClause(false, undefined, factory.createNamedImports(
        typeNames.map(namedImport),
      )),
      factory.createStringLiteral(typesModule),
    ),
  ];
}

function buildConfigType(name: string, sendOps: [string, Operation][]): Statement {
  return factory.createTypeAliasDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    name,
    undefined,
    factory.createTypeLiteralNode(
      sendOps.map(([opName]) => factory.createPropertySignature(
        undefined,
        factory.createIdentifier(toCamelCase(stripActionPrefix(opName)) + 'TopicArn'),
        undefined,
        factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
      )),
    ),
  );
}


function buildMethodArrow(op: Operation, param: string, configField: string) {
  const publishArgs = [
    factory.createPropertyAssignment(
      'TopicArn',
      factory.createPropertyAccessExpression(factory.createIdentifier('config'), configField),
    ),
    factory.createPropertyAssignment(
      'Message',
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier('JSON'), 'stringify'),
        undefined,
        [factory.createIdentifier(param)],
      ),
    ),
  ];

  const subject = getSnsSubject(op);
  if (subject) {
    publishArgs.push(factory.createPropertyAssignment('Subject', factory.createStringLiteral(subject)));
  }

  const awaitSend = factory.createAwaitExpression(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('sns'), 'send'),
      undefined,
      [factory.createNewExpression(
        factory.createIdentifier('PublishCommand'),
        undefined,
        [factory.createObjectLiteralExpression(publishArgs, true)],
      )],
    ),
  );

  return factory.createArrowFunction(
    [factory.createToken(SyntaxKind.AsyncKeyword)],
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, param)],
    undefined,
    factory.createToken(SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock([factory.createExpressionStatement(awaitSend)], true),
  );
}

function buildFactoryFunction(clientType: string, configType: string, sendOps: [string, Operation][]): Statement {
  const snsDecl = factory.createVariableStatement(
    undefined,
    factory.createVariableDeclarationList([
      factory.createVariableDeclaration(
        'sns',
        undefined,
        undefined,
        factory.createNewExpression(factory.createIdentifier('SNSClient'), undefined, [
          factory.createObjectLiteralExpression([]),
        ]),
      ),
    ], NodeFlags.Const),
  );

  const properties = sendOps.map(([name, op]) => {
    const param = toCamelCase(stripActionPrefix(name));
    return factory.createPropertyAssignment(name, buildMethodArrow(op, param, param + 'TopicArn'));
  });

  return factory.createFunctionDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    undefined,
    'create' + clientType,
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, 'config', undefined, factory.createTypeReferenceNode(configType))],
    factory.createTypeReferenceNode(clientType),
    factory.createBlock([
      snsDecl,
      factory.createReturnStatement(factory.createObjectLiteralExpression(properties, true)),
    ], true),
  );
}

function printFile(statements: Statement[]): string {
  const sourceFile = factory.createSourceFile(statements, factory.createToken(SyntaxKind.EndOfFileToken), NodeFlags.None);
  return printer.printNode(EmitHint.Unspecified, sourceFile, sourceFile);
}

export default function ({ asyncapi }: { asyncapi: AsyncAPIDocument }) {
  const raw = asyncapi.json();
  const slug = toSlug(raw.info?.title ?? 'asyncapi');
  const operations = Object.entries(raw.operations ?? {}) as [string, Operation][];
  const sendOps = operations.filter(([, op]) => op.action === 'send');

  if (sendOps.length === 0) return [];

  const clientType = slugToPascalCase(slug) + 'Client';
  const configType = clientType + 'Config';

  const statements: Statement[] = [
    ...buildImports([clientType], `./${slug}`),
    buildConfigType(configType, sendOps),
    buildFactoryFunction(clientType, configType, sendOps),
  ];

  return [
    <FileWithChildren name={`${slug}-aws-client.ts`}>
      {`// Generated — do not edit manually\n\n${printFile(statements)}`}
    </FileWithChildren>,
  ];
}
