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
  'x-amqp-routing-key'?: string;
}

type Operation = {
  action: 'send' | 'receive';
  channel?: {
    messages?: Record<string, Message>;
  };
}

type AsyncAPIDocument = {
  json(): {
    info?: { title?: string; 'x-amqp-exchange'?: string };
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

function toKebabCase(str: string): string {
  return str.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '');
}

function getRoutingKey(op: Operation, opName: string): string {
  return Object.values(op.channel?.messages ?? {})[0]?.['x-amqp-routing-key']
    ?? toKebabCase(stripActionPrefix(opName));
}

function buildImports(clientType: string, typesModule: string): Statement[] {
  return [
    factory.createImportDeclaration(
      undefined,
      factory.createImportClause(false, factory.createIdentifier('amqplib'), undefined),
      factory.createStringLiteral('amqplib'),
    ),
    factory.createImportDeclaration(
      undefined,
      factory.createImportClause(true, undefined, factory.createNamedImports([
        factory.createImportSpecifier(false, undefined, factory.createIdentifier(clientType)),
      ])),
      factory.createStringLiteral(typesModule),
    ),
  ];
}

function buildConfigType(name: string, includeExchange: boolean): Statement {
  const stringProp = (key: string) => factory.createPropertySignature(
    undefined,
    factory.createIdentifier(key),
    undefined,
    factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
  );
  const props = includeExchange ? [stringProp('url'), stringProp('exchange')] : [stringProp('url')];
  return factory.createTypeAliasDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    name,
    undefined,
    factory.createTypeLiteralNode(props),
  );
}

function buildMethodArrow(op: Operation, opName: string, param: string, exchange: string | undefined) {
  const routingKey = getRoutingKey(op, opName);
  const exchangeExpr = exchange
    ? factory.createStringLiteral(exchange)
    : factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'exchange');

  const publishCall = factory.createExpressionStatement(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier('channel'), 'publish'),
      undefined,
      [
        exchangeExpr,
        factory.createStringLiteral(routingKey),
        factory.createCallExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier('Buffer'), 'from'),
          undefined,
          [factory.createCallExpression(
            factory.createPropertyAccessExpression(factory.createIdentifier('JSON'), 'stringify'),
            undefined,
            [factory.createIdentifier(param)],
          )],
        ),
      ],
    ),
  );

  const waitForConfirms = factory.createExpressionStatement(
    factory.createAwaitExpression(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier('channel'), 'waitForConfirms'),
        undefined,
        [],
      ),
    ),
  );

  return factory.createArrowFunction(
    [factory.createToken(SyntaxKind.AsyncKeyword)],
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, param)],
    undefined,
    factory.createToken(SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock([publishCall, waitForConfirms], true),
  );
}

function awaitCall(obj: string, method: string, args: Parameters<typeof factory.createCallExpression>[2] = []) {
  return factory.createAwaitExpression(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(factory.createIdentifier(obj), method),
      undefined,
      args,
    ),
  );
}

function buildFactoryFunction(clientType: string, configType: string, sendOps: [string, Operation][], exchange: string | undefined): Statement {
  const makeConst = (name: string, init: ReturnType<typeof factory.createAwaitExpression>) =>
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList([
        factory.createVariableDeclaration(name, undefined, undefined, init),
      ], NodeFlags.Const),
    );

  const connectionDecl = makeConst('connection', awaitCall('amqplib', 'connect', [
    factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'url'),
  ]));

  const channelDecl = makeConst('channel', awaitCall('connection', 'createConfirmChannel'));

  const exchangeExpr = exchange
    ? factory.createStringLiteral(exchange)
    : factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'exchange');

  const assertExchangeStmt = factory.createExpressionStatement(
    factory.createAwaitExpression(
      factory.createCallExpression(
        factory.createPropertyAccessExpression(factory.createIdentifier('channel'), 'assertExchange'),
        undefined,
        [
          exchangeExpr,
          factory.createStringLiteral('topic'),
          factory.createObjectLiteralExpression([
            factory.createPropertyAssignment('durable', factory.createTrue()),
          ], false),
        ],
      ),
    ),
  );

  const closeProp = factory.createPropertyAssignment(
    'close',
    factory.createArrowFunction(
      [factory.createToken(SyntaxKind.AsyncKeyword)],
      undefined, [],
      undefined,
      factory.createToken(SyntaxKind.EqualsGreaterThanToken),
      factory.createBlock([
        factory.createExpressionStatement(
          factory.createAwaitExpression(
            factory.createCallExpression(
              factory.createPropertyAccessExpression(factory.createIdentifier('connection'), 'close'),
              undefined, [],
            ),
          ),
        ),
      ], true),
    ),
  );

  const properties = sendOps.map(([name, op]) => {
    const param = toCamelCase(stripActionPrefix(name));
    return factory.createPropertyAssignment(name, buildMethodArrow(op, name, param, exchange));
  });

  const returnType = factory.createTypeReferenceNode('Promise', [
    factory.createIntersectionTypeNode([
      factory.createTypeReferenceNode(clientType),
      factory.createTypeLiteralNode([
        factory.createPropertySignature(
          undefined,
          factory.createIdentifier('close'),
          undefined,
          factory.createFunctionTypeNode(undefined, [],
            factory.createTypeReferenceNode('Promise', [factory.createKeywordTypeNode(SyntaxKind.VoidKeyword)]),
          ),
        ),
      ]),
    ]),
  ]);

  const factoryName = 'create' + clientType.replace(/Client$/, 'AmqpClient');

  return factory.createFunctionDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword), factory.createToken(SyntaxKind.AsyncKeyword)],
    undefined,
    factoryName,
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, 'config', undefined, factory.createTypeReferenceNode(configType))],
    returnType,
    factory.createBlock([
      connectionDecl,
      channelDecl,
      assertExchangeStmt,
      factory.createReturnStatement(factory.createObjectLiteralExpression([...properties, closeProp], true)),
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
  const exchange = raw.info?.['x-amqp-exchange'];
  const operations = Object.entries(raw.operations ?? {}) as [string, Operation][];
  const sendOps = operations.filter(([, op]) => op.action === 'send');

  if (sendOps.length === 0) return [];

  const clientType = slugToPascalCase(slug) + 'Client';
  const configType = clientType.replace(/Client$/, 'AmqpClientConfig');

  const statements: Statement[] = [
    ...buildImports(clientType, `./${slug}`),
    buildConfigType(configType, exchange === undefined),
    buildFactoryFunction(clientType, configType, sendOps, exchange),
  ];

  return [
    <FileWithChildren name={`${slug}-amqp-client.ts`}>
      {`// Generated — do not edit manually\n\n${printFile(statements)}`}
    </FileWithChildren>,
  ];
}
