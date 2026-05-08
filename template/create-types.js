import { jsx as _jsx } from "react/jsx-runtime";
import { File } from '@asyncapi/generator-react-sdk';
import { transformSchemaObject } from 'openapi-typescript';
import { createPrinter, EmitHint, NewLineKind, NodeFlags, factory, SyntaxKind, addSyntheticLeadingComment, } from 'typescript';
const printer = createPrinter({ newLine: NewLineKind.LineFeed });
function createSchemaAst(name, schema) {
    const schemaNode = transformSchemaObject(schema, { ctx: {} });
    return factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], name, undefined, schemaNode);
}
function addCommentAst(decl, comment) {
    return addSyntheticLeadingComment(decl, SyntaxKind.MultiLineCommentTrivia, comment, true);
}
function createParameterAst(name, message) {
    const payloadType = message?.payload?.['x-parser-schema-id'] ?? 'unknown';
    return factory.createParameterDeclaration(undefined, undefined, factory.createIdentifier(name), undefined, factory.createTypeReferenceNode(factory.createIdentifier(payloadType), undefined), undefined);
}
function createOperationAst(name, operation) {
    const node = factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], factory.createIdentifier(name.replace(/^[a-z]/, (m) => m.toUpperCase())), undefined, factory.createFunctionTypeNode(undefined, Object.entries(operation.channel?.messages ?? {}).map(([name, message]) => createParameterAst(name, message)), factory.createTypeReferenceNode(factory.createIdentifier('Promise'), [
        factory.createKeywordTypeNode(SyntaxKind.VoidKeyword),
    ])));
    return addCommentAst(node, ` ${operation.summary} `);
}
function printFile(nodes) {
    const sourceFileNode = factory.createSourceFile(nodes, factory.createToken(SyntaxKind.EndOfFileToken), NodeFlags.None);
    return printer.printNode(EmitHint.Unspecified, sourceFileNode, sourceFileNode);
}
function createTypesFile(clientTypeName, schemas, sendOps, receiveOps) {
    const schemaNodes = Object.entries(schemas).map(([name, schema]) => createSchemaAst(name, schema));
    const sendTypeNodes = sendOps.map(([id, op]) => createOperationAst(id, op));
    const receiveTypeNodes = receiveOps.map(([id, op]) => createOperationAst(id, op));
    const clientTypeNode = createClientTypeAst(clientTypeName, sendOps);
    return printFile([...schemaNodes, ...sendTypeNodes, ...receiveTypeNodes, clientTypeNode]);
}
const FileWithChildren = File;
function toSlug(title) {
    return title.toLowerCase().replace(/\s+/g, '-');
}
function slugToPascalCase(slug) {
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}
function toPascalCase(str) {
    return str.replace(/^[a-z]/, (m) => m.toUpperCase());
}
function createClientTypeAst(name, sendOps) {
    return factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], name, undefined, factory.createTypeLiteralNode(sendOps.map(([opName]) => factory.createPropertySignature(undefined, factory.createIdentifier(opName), undefined, factory.createTypeReferenceNode(factory.createIdentifier(toPascalCase(opName)))))));
}
export default function ({ asyncapi }) {
    const raw = asyncapi.json();
    const slug = toSlug(raw.info?.title ?? 'asyncapi');
    const clientTypeName = slugToPascalCase(slug) + 'Client';
    const schemas = raw.components?.schemas ?? {};
    const operations = Object.entries(raw.operations ?? {});
    const sendOps = operations.filter(([, op]) => op.action === 'send');
    const receiveOps = operations.filter(([, op]) => op.action === 'receive');
    return [
        _jsx(FileWithChildren, { name: `${slug}.d.ts`, children: `// Generated — do not edit manually\n\n${createTypesFile(clientTypeName, schemas, sendOps, receiveOps)}\n` }),
    ];
}
