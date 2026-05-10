import { jsx as _jsx } from "react/jsx-runtime";
import { File } from '@asyncapi/generator-react-sdk';
import { createPrinter, EmitHint, NewLineKind, NodeFlags, factory, SyntaxKind, } from 'typescript';
const FileWithChildren = File;
const printer = createPrinter({ newLine: NewLineKind.LineFeed });
function toSlug(title) {
    return title.toLowerCase().replace(/\s+/g, '-');
}
function slugToPascalCase(slug) {
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function stripActionPrefix(name) {
    return name.replace(/^(send|receive)/i, '');
}
function toCamelCase(str) {
    return str.charAt(0).toLowerCase() + str.slice(1);
}
function toKebabCase(str) {
    return str.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '');
}
function getRoutingKey(op, opName) {
    return Object.values(op.channel?.messages ?? {})[0]?.['x-amqp-routing-key']
        ?? toKebabCase(stripActionPrefix(opName));
}
function buildImports(clientType, typesModule) {
    return [
        factory.createImportDeclaration(undefined, factory.createImportClause(false, factory.createIdentifier('amqplib'), undefined), factory.createStringLiteral('amqplib')),
        factory.createImportDeclaration(undefined, factory.createImportClause(true, undefined, factory.createNamedImports([
            factory.createImportSpecifier(false, undefined, factory.createIdentifier(clientType)),
        ])), factory.createStringLiteral(typesModule)),
    ];
}
function buildConfigType(name, includeExchange) {
    const stringProp = (key) => factory.createPropertySignature(undefined, factory.createIdentifier(key), undefined, factory.createKeywordTypeNode(SyntaxKind.StringKeyword));
    const props = includeExchange ? [stringProp('url'), stringProp('exchange')] : [stringProp('url')];
    return factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], name, undefined, factory.createTypeLiteralNode(props));
}
function buildMethodArrow(op, opName, param, exchange) {
    const routingKey = getRoutingKey(op, opName);
    const exchangeExpr = exchange
        ? factory.createStringLiteral(exchange)
        : factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'exchange');
    const publishCall = factory.createExpressionStatement(factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('channel'), 'publish'), undefined, [
        exchangeExpr,
        factory.createStringLiteral(routingKey),
        factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('Buffer'), 'from'), undefined, [factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('JSON'), 'stringify'), undefined, [factory.createIdentifier(param)])]),
    ]));
    return factory.createArrowFunction([factory.createToken(SyntaxKind.AsyncKeyword)], undefined, [factory.createParameterDeclaration(undefined, undefined, param)], undefined, factory.createToken(SyntaxKind.EqualsGreaterThanToken), factory.createBlock([publishCall], true));
}
function buildFactoryFunction(clientType, configType, sendOps, exchange) {
    const awaitDecl = (varName, expr) => factory.createVariableStatement(undefined, factory.createVariableDeclarationList([
        factory.createVariableDeclaration(varName, undefined, undefined, factory.createAwaitExpression(expr)),
    ], NodeFlags.Const));
    const connectionDecl = awaitDecl('connection', factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('amqplib'), 'connect'), undefined, [factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'url')]));
    const channelDecl = awaitDecl('channel', factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('connection'), 'createChannel'), undefined, []));
    const exchangeExpr = exchange
        ? factory.createStringLiteral(exchange)
        : factory.createPropertyAccessExpression(factory.createIdentifier('config'), 'exchange');
    const assertExchangeStmt = factory.createExpressionStatement(factory.createAwaitExpression(factory.createCallExpression(factory.createPropertyAccessExpression(factory.createIdentifier('channel'), 'assertExchange'), undefined, [
        exchangeExpr,
        factory.createStringLiteral('topic'),
        factory.createObjectLiteralExpression([
            factory.createPropertyAssignment('durable', factory.createTrue()),
        ], false),
    ])));
    const properties = sendOps.map(([name, op]) => {
        const param = toCamelCase(stripActionPrefix(name));
        return factory.createPropertyAssignment(name, buildMethodArrow(op, name, param, exchange));
    });
    const factoryName = 'create' + clientType.replace(/Client$/, 'AmqpClient');
    return factory.createFunctionDeclaration([factory.createToken(SyntaxKind.ExportKeyword), factory.createToken(SyntaxKind.AsyncKeyword)], undefined, factoryName, undefined, [factory.createParameterDeclaration(undefined, undefined, 'config', undefined, factory.createTypeReferenceNode(configType))], factory.createTypeReferenceNode('Promise', [factory.createTypeReferenceNode(clientType)]), factory.createBlock([
        connectionDecl,
        channelDecl,
        assertExchangeStmt,
        factory.createReturnStatement(factory.createObjectLiteralExpression(properties, true)),
    ], true));
}
function printFile(statements) {
    const sourceFile = factory.createSourceFile(statements, factory.createToken(SyntaxKind.EndOfFileToken), NodeFlags.None);
    return printer.printNode(EmitHint.Unspecified, sourceFile, sourceFile);
}
export default function ({ asyncapi }) {
    const raw = asyncapi.json();
    const slug = toSlug(raw.info?.title ?? 'asyncapi');
    const exchange = raw.info?.['x-amqp-exchange'];
    const operations = Object.entries(raw.operations ?? {});
    const sendOps = operations.filter(([, op]) => op.action === 'send');
    if (sendOps.length === 0)
        return [];
    const clientType = slugToPascalCase(slug) + 'Client';
    const configType = clientType.replace(/Client$/, 'AmqpClientConfig');
    const statements = [
        ...buildImports(clientType, `./${slug}`),
        buildConfigType(configType, exchange === undefined),
        buildFactoryFunction(clientType, configType, sendOps, exchange),
    ];
    return [
        _jsx(FileWithChildren, { name: `${slug}-amqp-client.ts`, children: `// Generated — do not edit manually\n\n${printFile(statements)}` }),
    ];
}
