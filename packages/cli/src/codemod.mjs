import ts from "typescript";

export const marker = "/* kue-qa:managed */";

/** Restrict edits to JSX returns in the default component; never rewrite nested callbacks. */
export function addKue(source, configImport) {
  if (source.includes(marker)) return source;
  if (source.includes("@kue-qa/react-native") || /\b(?:KueCapture|kueCloudConfig)\b/u.test(source)) {
    throw new Error("KUE or a conflicting identifier is already present. Integrate Kue manually; no source was changed.");
  }
  const file = ts.createSourceFile("root.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (file.parseDiagnostics.length) throw new Error("The app root has syntax errors; fix them before running init.");
  let component;
  let defaultName;
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) component = statement;
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      if (ts.isIdentifier(statement.expression)) defaultName = statement.expression.text;
      else if (ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression)) component = statement.expression;
    }
  }
  if (defaultName) {
    for (const statement of file.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === defaultName) component = statement;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === defaultName && declaration.initializer &&
            (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) component = declaration.initializer;
        }
      }
    }
  }
  if (!component?.body || component.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) {
    throw new Error("Could not safely identify a synchronous default React component. Add <Kue cloud={...} /> manually.");
  }
  const edits = [];
  const wrap = (expression) => {
    let jsx = expression;
    while (ts.isParenthesizedExpression(jsx)) jsx = jsx.expression;
    if (!ts.isJsxElement(jsx) && !ts.isJsxSelfClosingElement(jsx) && !ts.isJsxFragment(jsx)) return;
    edits.push({ start: expression.getStart(file), end: expression.end,
      text: `(<>{${source.slice(expression.getStart(file), expression.end)}}<KueCapture cloud={kueCloudConfig} /></>)` });
  };
  if (ts.isBlock(component.body)) {
    const visit = (node) => {
      if (ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && node.expression) wrap(node.expression);
      else ts.forEachChild(node, visit);
    };
    ts.forEachChild(component.body, visit);
  } else wrap(component.body);
  if (!edits.length) throw new Error("No direct JSX return found in the default component. Add Kue manually; no source was changed.");
  // Keep use-client/use-strict directives at the start of the module.
  let importOffset = 0;
  for (const statement of file.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) importOffset = statement.end;
    else break;
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  edits.push({ start: importOffset, end: importOffset,
    text: `${newline}${marker}${newline}import { Kue as KueCapture } from "@kue-qa/react-native";${newline}import { kueCloudConfig } from ${JSON.stringify(configImport)};${newline}` });
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
