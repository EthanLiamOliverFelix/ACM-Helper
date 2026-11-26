// A block header ends in a colon outside strings and comments.
// Closing brackets on their own line also cover multiline headers.
export const pythonBlockIndentPattern = /^\s*(?:(?:(?:async\s+)?(?:def|for|with)|class|if|elif|else|while|try|except|finally|match|case)\b(?:[^#"'\r\n]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*|[)\]}]+)\s*:\s*(?:#.*)?$/
