/**
 * Port of VS Code's terminalLinkParsing.ts (unix paths only).
 * https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminalContrib/links/browser/terminalLinkParsing.ts
 */

export interface IParsedLink {
    path: ILinkPartialRange;
    prefix?: ILinkPartialRange;
    suffix?: ILinkSuffix;
}

export interface ILinkSuffix {
    row: number | undefined;
    col: number | undefined;
    rowEnd: number | undefined;
    colEnd: number | undefined;
    suffix: ILinkPartialRange;
}

export interface ILinkPartialRange {
    index: number;
    text: string;
}

function generateLinkSuffixRegex(eolOnly: boolean): RegExp {
    let ri = 0, ci = 0, rei = 0, cei = 0;
    const r = () => `(?<row${ri++}>\\d+)`;
    const c = () => `(?<col${ci++}>\\d+)`;
    const re = () => `(?<rowEnd${rei++}>\\d+)`;
    const ce = () => `(?<colEnd${cei++}>\\d+)`;
    const eolSuffix = eolOnly ? '$' : '';

    // Supports 20+ formats: foo:339:12, foo(339, 12), "foo" line 339 col 12, etc.
    const clauses = [
        `(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?` + eolSuffix,
        `['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?` + eolSuffix,
        `:? ?[\\[\\(]${r()}(?:(?:, ?|:)${c()})?[\\]\\)]` + eolSuffix,
    ];

    const clause = clauses.join('|').replace(/ /g, `[  ]`);
    return new RegExp(`(${clause})`, eolOnly ? undefined : 'g');
}

const linkSuffixRegexEol = generateLinkSuffixRegex(true);
const linkSuffixRegexGlobal = generateLinkSuffixRegex(false);

// Path chars: must not start with whitespace/brackets/pipes; must not contain whitespace/pipes/angle brackets
const linkWithSuffixPathChars = /(?<path>(?:file:\/\/\/)?[^\s|<>\[({][^\s|<>]*)$/;

// Unix local link: /foo, ~/foo, ./foo, ../foo, foo/bar
const unixLocalLinkClause = '(?:(?:(?:\\.\\.|\\.|\\~|file:\\/\\/)|(?:[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\][^\\0<>\\?\\s!`&*()\'":;\\\\]*))?(?:\\/(?:[^\\0<>\\?\\s!`&*()\'":;\\\\])+)+)';

function toLinkSuffix(match: RegExpExecArray | null): ILinkSuffix | null {
    const groups = match?.groups;
    if (!groups || match.length < 1) return null;
    return {
        row: parseIntOpt(groups.row0 || groups.row1 || groups.row2),
        col: parseIntOpt(groups.col0 || groups.col1 || groups.col2),
        rowEnd: parseIntOpt(groups.rowEnd0 || groups.rowEnd1),
        colEnd: parseIntOpt(groups.colEnd0 || groups.colEnd1),
        suffix: { index: match.index, text: match[0] },
    };
}

function parseIntOpt(v: string | undefined): number | undefined {
    return v === undefined ? undefined : parseInt(v);
}

function detectLinkSuffixes(line: string): ILinkSuffix[] {
    const results: ILinkSuffix[] = [];
    linkSuffixRegexGlobal.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = linkSuffixRegexGlobal.exec(line)) !== null) {
        const suffix = toLinkSuffix(match);
        if (!suffix) break;
        results.push(suffix);
    }
    return results;
}

function detectLinksViaSuffix(line: string): IParsedLink[] {
    const results: IParsedLink[] = [];
    for (const suffix of detectLinkSuffixes(line)) {
        const before = line.substring(0, suffix.suffix.index);
        const m = before.match(linkWithSuffixPathChars);
        if (!m || m.index === undefined || !m.groups?.path) continue;

        let startIndex = m.index;
        let pathText = m.groups.path;
        let prefix: ILinkPartialRange | undefined;

        const prefixM = pathText.match(/^(?<p>['"]+)/);
        if (prefixM?.groups?.p) {
            prefix = { index: startIndex, text: prefixM.groups.p };
            pathText = pathText.substring(prefix.text.length);
            if (!pathText.trim()) continue;
        }

        results.push({
            path: { index: startIndex + (prefix?.text.length ?? 0), text: pathText },
            prefix,
            suffix,
        });
    }
    return results;
}

// Bare filename with no directory component (e.g. foo.ts, package.json, .env, .gitignore).
// Two alternatives: normal name.ext, or dotfile (.name or .name.ext).
// Skips matches preceded by '/', '.', or a word/dash char (i.e. part of a longer path).
function detectBareFilenameLinks(line: string): IParsedLink[] {
    const results: IParsedLink[] = [];
    const regex = /([a-zA-Z0-9_][a-zA-Z0-9_.\-]*\.[a-zA-Z][a-zA-Z0-9_]*|\.[a-zA-Z][a-zA-Z0-9_\-]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
        const text = match[1];
        const index = match.index;
        if (!text) continue;
        if (index > 0 && /[/.\w\-]/.test(line[index - 1])) continue;
        results.push({ path: { index, text } });
    }
    return results;
}

function detectPathsNoSuffix(line: string): IParsedLink[] {
    const results: IParsedLink[] = [];
    const regex = new RegExp(unixLocalLinkClause, 'g');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
        let text = match[0];
        let index = match.index;
        if (!text) break;
        // Strip git diff a/ b/ prefix
        if (
            ((line.startsWith('--- a/') || line.startsWith('+++ b/')) && index === 4) ||
            (line.startsWith('diff --git') && (text.startsWith('a/') || text.startsWith('b/')))
        ) {
            text = text.substring(2);
            index += 2;
        }
        results.push({ path: { index, text } });
    }
    return results;
}

function binaryInsert(list: IParsedLink[], item: IParsedLink, low: number, high: number) {
    if (list.length === 0) { list.push(item); return; }
    if (low > high) return;
    const mid = Math.floor((low + high) / 2);
    if (
        mid >= list.length ||
        (item.path.index < list[mid].path.index && (mid === 0 || item.path.index > list[mid - 1].path.index))
    ) {
        if (
            mid >= list.length ||
            (item.path.index + item.path.text.length < list[mid].path.index &&
                (mid === 0 || item.path.index > list[mid - 1].path.index + list[mid - 1].path.text.length))
        ) {
            list.splice(mid, 0, item);
        }
        return;
    }
    if (item.path.index > list[mid].path.index) {
        binaryInsert(list, item, mid + 1, high);
    } else {
        binaryInsert(list, item, low, mid - 1);
    }
}

export function detectLinks(line: string): IParsedLink[] {
    const results = detectLinksViaSuffix(line);
    for (const item of detectPathsNoSuffix(line)) {
        binaryInsert(results, item, 0, results.length);
    }
    for (const item of detectBareFilenameLinks(line)) {
        binaryInsert(results, item, 0, results.length);
    }
    return results;
}
