import { File } from '@asyncapi/generator-react-sdk';
import { transformSchemaObject } from 'openapi-typescript'
import { createPrinter, EmitHint, NewLineKind, factory, SyntaxKind, addSyntheticLeadingComment } from 'typescript';

const printer = createPrinter({ newLine: NewLineKind.LineFeed });

function createSchemaAst(name, schema) {
  const schemaNode = transformSchemaObject(schema, { ctx: { } });
  return factory.createTypeAliasDeclaration([factory.createToken(SyntaxKind.ExportKeyword)], name, undefined, schemaNode);
}

function addCommentAst(decl, comment) {
  return addSyntheticLeadingComment(
    decl,
    SyntaxKind.MultiLineCommentTrivia,
    comment,
    true,
  );
}

function createParameterAst(name, message) {
  const payloadType = message?.payload?.['x-parser-schema-id'] ?? 'unknown';
  const node = factory.createParameterDeclaration(
    undefined,
    undefined,
    factory.createIdentifier(name),
    undefined,
    factory.createTypeReferenceNode(
      factory.createIdentifier(payloadType),
      undefined
    ),
    undefined
  );
  return node;
}

function createOperationAst(name, operation) {
  const node = factory.createTypeAliasDeclaration(
    [factory.createToken(SyntaxKind.ExportKeyword)],
    factory.createIdentifier(name.replace(/^[a-z]/, (m) => m.toUpperCase())),
    undefined,
    factory.createFunctionTypeNode(
      undefined,
      Object.entries(operation.channel?.messages ?? {}).map(([name, message]) => createParameterAst(name, message)),
      factory.createTypeReferenceNode(
        factory.createIdentifier("Promise"),
        [factory.createKeywordTypeNode(SyntaxKind.VoidKeyword)]
      )
    )
  );
  return addCommentAst(node, ` ${operation.summary} `);
}

function printFile(nodes) {
  const sourceFileNode = factory.createSourceFile(nodes);
  return printer.printNode(EmitHint.Unspecified, sourceFileNode);
}

function createTypesFile(schemas, sendOps, receiveOps) {
  const schemaNodes = Object.entries(schemas).map(([name, schema]) => createSchemaAst(name, schema));
  const sendTypeNodes = sendOps.map(([id, op]) => createOperationAst(id, op));
  const receiveTypeNodes = receiveOps.map(([id, op]) => createOperationAst(id, op));
  return printFile([...schemaNodes, ...sendTypeNodes, ...receiveTypeNodes]);
}

function createAwsClientFile(sendOps) {

}

export default function ({ asyncapi }) {
  const raw = asyncapi.json();
  const schemas = raw.components?.schemas ?? {};
  const operations = Object.entries(raw.operations ?? {});

  const sendOps = operations.filter(([, op]) => op.action === 'send');
  const receiveOps = operations.filter(([, op]) => op.action === 'receive');

  // const imports = `import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';\n\n`;

  return ([
    <File name="account.d.ts">
      {`// Generated from asyncapi/account.asyncapi.yaml — do not edit manually\n\n${createTypesFile(schemas, sendOps, receiveOps)}\n`}
    </File>
  ]);
}
