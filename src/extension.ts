'use strict';
import { StatusBar } from './status_bar';
import * as utils from './utils';
import { commands, window, ExtensionContext, workspace, ConfigurationChangeEvent, } from 'vscode';
import * as vscode from 'vscode';

let paredit_theme_d = require('paredit-theme-d.js');

const languages = new Set(["theme-d"]);
let enabled = true,
    expandState = { range: null, prev: null };

const navigate = (fn, opts = {}) =>
    ({ textEditor, ast, selection }) => {
        let res = fn(ast, selection.cursor);
        if (res == selection.cursor && opts["_unlessMoved"]) {
            opts["_unlessMoved"]({ textEditor, ast, selection });
        }
        utils.select(textEditor, res);
    }

const yank = (fn, ...args) =>
    ({ textEditor, ast, selection }) => {
        let res = fn(ast, selection.cursor, ...args),
            positions = typeof (res) === "number" ? [selection.cursor, res] : res;
        utils.copy(textEditor, positions);
    }

const cut = (fn, ...args) =>
    ({ textEditor, ast, selection }) => {
        let res = fn(ast, selection.cursor, ...args),
            positions = typeof (res) === "number" ? [selection.cursor, res] : res;
        utils.cut(textEditor, positions);
    }

const navigateExpandSelecion = (fn, ...args) =>
    ({ textEditor, ast, selection }) => {
        let range = textEditor.selection,
            res = fn(ast, selection.start, selection.end, ...args);
        if (expandState.prev == null || !range.contains(expandState.prev.range)) {
            expandState = { range: range, prev: null };
        }
        expandState = { range: utils.select(textEditor, res), prev: expandState };
    }

function navigateContractSelecion({ textEditor, selection }) {
    let range = textEditor.selection;
    if (expandState.prev && expandState.prev.range && range.contains(expandState.prev.range)) {
        textEditor.selection = expandState.prev.range;
        expandState = expandState.prev;
    }
}

function indent({ textEditor, selection }) {
    // console.log("indent");
    let src = textEditor.document.getText(),
        ast = paredit_theme_d.parse(src),
        res = paredit_theme_d.editor.indentRange(ast, src, selection.start, selection.end);
    // console.log("HEP1");
    utils
    .edit(textEditor, utils.commands(res))
    .then((applied?) => utils.undoStop(textEditor))
    .then((x) => vscode.window.showInformationMessage("Indentation completed", "Close"));
}

function indent2({ textEditor, selection }) {
    // console.log("indent2");
    let src = textEditor.document.getText(),
        ast = paredit_theme_d.parse(src),
        res = paredit_theme_d.editor.indentRange(ast, src, selection.start, selection.end);
    // console.log("HEP2");
    utils
    .edit(textEditor, utils.commands(res))
    .then((applied?) => utils.undoStop(textEditor));
}

function leftChar({ textEditor, selection }) {
    commands.executeCommand('cursorMove', { to: "left" })
}

function rightChar({ textEditor, selection }) {
    commands.executeCommand('cursorMove', { to: "right" })
}

const wrapAround = (ast, src, start, { opening, closing }) => paredit_theme_d.editor.wrapAround(ast, src, start, opening, closing);

const edit = (fn, opts = {}) =>
    ({ textEditor, src, ast, selection }) => {
        let { start, end } = selection;
        let res = fn(ast, src, selection.start, { ...opts, endIdx: start === end ? undefined : end });

        if (res)
            if (res.changes.length > 0) {
                if (fn == paredit_theme_d.editor.delete) {
                    // Use VSCode's delete to delete indent if any
                    if (opts['backward']) {
                        commands.executeCommand("deleteLeft")
                    } else {
                        commands.executeCommand("deleteRight")
                    }
                    return
                }
                let cmd = utils.commands(res),
                    sel = {
                        start: Math.min(...cmd.map(c => c.start)),
                        end: Math.max(...cmd.map(utils.end))
                    };

                utils
                    .edit(textEditor, cmd)
                    .then((applied?) => {
                        utils.select(textEditor, res.newIndex);
                    });
            }
            else {
                if (opts["_unlessApplied"]) {
                    opts["_unlessApplied"]({ textEditor, selection });
                }
                utils.select(textEditor, res.newIndex);
            }
    }

const createNavigationCopyCutCommands = (commands) => {
    const capitalizeFirstLetter = (s) => { return s.charAt(0).toUpperCase() + s.slice(1); }

    let result: [string, Function][] = new Array<[string, Function]>();
    Object.keys(commands).forEach((c) => {
        result.push([`paredit_theme_d.${c}`, navigate(commands[c][0], commands[c][1])]);
        result.push([`paredit_theme_d.yank${capitalizeFirstLetter(c)}`, yank(commands[c][0])]);
        result.push([`paredit_theme_d.cut${capitalizeFirstLetter(c)}`, cut(commands[c][0])]);
    });
    return result;
}

const navCopyCutcommands = {
    'rangeForDefun': [paredit_theme_d.navigator.rangeForDefun, {}],
    'forwardSexp': [paredit_theme_d.navigator.forwardSexp, { '_unlessMoved': rightChar }],
    'backwardSexp': [paredit_theme_d.navigator.backwardSexp, { '_unlessMoved': leftChar }],
    'forwardDownSexp': [paredit_theme_d.navigator.forwardDownSexp, {}],
    'backwardUpSexp': [paredit_theme_d.navigator.backwardUpSexp, {}],
    'closeList': [paredit_theme_d.navigator.closeList, {}],
    'closeList2': [paredit_theme_d.navigator.closeList, {}]
};

const pareditCommands: [string, Function][] = [

    // SELECTING
    ['paredit_theme_d.sexpRangeExpansion', navigateExpandSelecion(paredit_theme_d.navigator.sexpRangeExpansion)],
    ['paredit_theme_d.sexpRangeContraction', navigateContractSelecion],

    // NAVIGATION, COPY, CUT
    // (Happens in createNavigationCopyCutCommands())

    // EDITING
    ['paredit_theme_d.openList', edit(paredit_theme_d.editor.openList)],
    ['paredit_theme_d.slurpSexpForward', edit(paredit_theme_d.editor.slurpSexp, { 'backward': false })],
    ['paredit_theme_d.slurpSexpBackward', edit(paredit_theme_d.editor.slurpSexp, { 'backward': true })],
    ['paredit_theme_d.barfSexpForward', edit(paredit_theme_d.editor.barfSexp, { 'backward': false })],
    ['paredit_theme_d.barfSexpBackward', edit(paredit_theme_d.editor.barfSexp, { 'backward': true })],
    ['paredit_theme_d.spliceSexp', edit(paredit_theme_d.editor.spliceSexp)],
    ['paredit_theme_d.splitSexp', edit(paredit_theme_d.editor.splitSexp)],
    ['paredit_theme_d.killSexpForward', edit(paredit_theme_d.editor.killSexp, { 'backward': false })],
    ['paredit_theme_d.killSexpBackward', edit(paredit_theme_d.editor.killSexp, { 'backward': true })],
    ['paredit_theme_d.spliceSexpKillForward', edit(paredit_theme_d.editor.spliceSexpKill, { 'backward': false })],
    ['paredit_theme_d.spliceSexpKillBackward', edit(paredit_theme_d.editor.spliceSexpKill, { 'backward': true })],
    ['paredit_theme_d.deleteForward', edit(paredit_theme_d.editor.delete, { 'backward': false, '_unlessApplied': rightChar })],
    ['paredit_theme_d.deleteBackward', edit(paredit_theme_d.editor.delete, { 'backward': true, '_unlessApplied': leftChar })],
    ['paredit_theme_d.wrapAroundParens', edit(wrapAround, { opening: '(', closing: ')' })],
    ['paredit_theme_d.wrapAroundSquare', edit(wrapAround, { opening: '[', closing: ']' })],
    ['paredit_theme_d.wrapAroundCurly', edit(wrapAround, { opening: '{', closing: '}' })],
    ['paredit_theme_d.indentRange', indent],
    ['paredit_theme_d.indentRangeNoMessage', indent2],
    ['paredit_theme_d.transpose', edit(paredit_theme_d.editor.transpose)]];

function wrapPareditCommand(fn) {
    return () => {

        let textEditor = window.activeTextEditor;
        let doc = textEditor.document;
        if (!enabled || !languages.has(doc.languageId)) return;

        let src = textEditor.document.getText();
        fn({
            textEditor: textEditor,
            src: src,
            ast: paredit_theme_d.parse(src),
            selection: utils.getSelection(textEditor)
        });
    }
}

function setKeyMapConf() {
    let keyMap = workspace.getConfiguration().get('paredit_theme_d.defaultKeyMap');
    commands.executeCommand('setContext', 'paredit_theme_d:keyMap', keyMap);
}
setKeyMapConf();

export function activate(context: ExtensionContext) {

    let statusBar = new StatusBar();

    context.subscriptions.push(
        statusBar,
        commands.registerCommand('paredit_theme_d.toggle', () => { enabled = !enabled; statusBar.enabled = enabled; }),
        window.onDidChangeActiveTextEditor((e) => statusBar.visible = e && e.document && languages.has(e.document.languageId)),
        workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
            console.log(e);
            if (e.affectsConfiguration('paredit_theme_d.defaultKeyMap')) {
                setKeyMapConf();
            }
        }),

        ...createNavigationCopyCutCommands(navCopyCutcommands)
            .map(([command, fn]) => commands.registerCommand(command, wrapPareditCommand(fn))),
        ...pareditCommands
            .map(([command, fn]) => commands.registerCommand(command, wrapPareditCommand(fn))));
}
export function deactivate() {
}