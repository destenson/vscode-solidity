'use strict';

import * as projService from './projectService';
import * as solc from 'solc';
import * as Solium from 'solium';
import {
    createConnection, IConnection,
    IPCMessageReader, IPCMessageWriter,
    TextDocuments, InitializeResult,
    Files, DiagnosticSeverity, TextDocumentChangeEvent,
} from 'vscode-languageserver';
import { ContractCollection } from "./model/contractsCollection";
import { errorToDiagnostic } from './compilerErrors';
// import * as path from 'path';

// Create a connection for the server
const connection: IConnection = createConnection(
    new IPCMessageReader(process),
    new IPCMessageWriter(process));

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

const documents: TextDocuments = new TextDocuments();

let rootPath;

function itemToDiagnostic(item) {
    const severity = item.type === 'warning' ?
        DiagnosticSeverity.Warning :
        DiagnosticSeverity.Error;

    const line = item.line - 1;

    return {
        message: `${item.ruleName}: ${item.message}`,
        range: {
            end: {
                character: item.node.end,
                line: line,
            },
            start: {
                character: item.column,
                line: line,
            },
        },
        severity: severity,
    };
}

export function compilationErrors(filePath, documentText) {
    const contracts = new ContractCollection();

    contracts.addContractAndResolveImports(
        filePath,
        documentText,
        projService.initialiseProject(rootPath));
    
    const output = solc.compile({sources: contracts.getContractsForCompilation()}, 1);

    if (output.errors) {
        return output.errors.map((error) => errorToDiagnostic(error).diagnostic);
    }

    return [];
}

function solium(filePath, documentText) {
    // const fileDirectory = path.dirname(filePath);
    // const fileName = path.basename(filePath);

    let items = [];

    try {
        items = Solium.lint(documentText, {
            // TODO climb up the filesystem until we find a .soliumrc.json and use that
            rules: {
                'array-declarations': true,
                'blank-lines': true,
                camelcase: true,
                'deprecated-suicide': true,
                'double-quotes': true,
                'imports-on-top': true,
                indentation: true,
                lbrace: true,
                mixedcase: true,
                'no-empty-blocks': true,
                'no-unused-vars': true,
                'no-with': true,
                'operator-whitespace': true,
                'pragma-on-top': true,
                uppercase: true,
                'variable-declarations': true,
                whitespace: true,
            },
        });
    } catch (err) {
        let match = /An error .*?\nSyntaxError: (.*?) Line: (\d+), Column: (\d+)/.exec(err.message);

        if (match) {
            let line = parseInt(match[2], 10) - 1;
            let character = parseInt(match[3], 10) - 1;

            return [
                {
                    message: `Syntax error: ${match[1]}`,
                    range: {
                        end: {
                            character: character,
                            line: line,
                        },
                        start: {
                            character: character,
                            line: line,
                        },
                    },
                    severity: DiagnosticSeverity.Error,
                },
            ];
        } else {
            connection.window.showErrorMessage('solium error: ' + err);
            console.error('solium error: ' + err);
        }
    }

    return items.map(itemToDiagnostic);
}

function validate(document) {
    const filePath = Files.uriToFilePath(document.uri);
    const documentText = document.getText();

    const soliumDiagnostics = solium(filePath, documentText);
    const solcDiagnostics = compilationErrors(filePath, documentText);

    const diagnostics = soliumDiagnostics.concat(solcDiagnostics);

    connection.sendDiagnostics({
        uri: document.uri,
        diagnostics,
    });
}

function validateAll() {
    return documents.all().forEach(document => validate(document));
}

documents.onDidChangeContent(event => validate(event.document));

// remove diagnostics from the Problems panel when we close the file
documents.onDidClose(event => connection.sendDiagnostics({
    diagnostics: [],
    uri: event.document.uri,
}));

documents.listen(connection);

connection.onInitialize((result): InitializeResult => {
    rootPath = result.rootPath;

    validateAll();

    return {
        capabilities: {
            textDocumentSync: documents.syncKind,
        },
    };
});

connection.onDidChangeConfiguration(() => validateAll());

connection.listen();
