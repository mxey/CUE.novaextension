
var langserver = null;

exports.activate = function() {
    langserver = new CUELanguageServer();

    nova.workspace.onDidAddTextEditor((editor) => {
        editor.onWillSave(async function (editor) {
            if (editor.document.syntax !== 'cue') {
                return
            };

            // Unfortunately Nova has no way to trigger the “Format Document”
            // menu entry that would use LSP to format, see
            // https://devforum.nova.app/t/trigger-built-in-menu-commands-change-focus-from-find-to-the-editor/2014
            // https://devforum.nova.app/t/format-on-save-support/2145/2
            //
            // We could send the request to the language server ourselves,
            // but shelling out to cue fmt is easier than handling the LSP response
            // for text changes.
            let path = nova.config.get('cue.path');
            if (!path) {
                path = '/opt/homebrew/bin/cue';
            }
            await pipeEditorThroughProcess(editor, path, ['fmt', '-']);
        });
    });
}

async function pipeEditorThroughProcess(editor, cmd, args) {
    let process = new Process(cmd, {
        args: args,
        stdio: 'pipe',
    });

    let stdout = [];
    process.onStdout(function (line) {
        stdout.push(line);
    });
    let stderr = [];
    process.onStderr(function (line) {
        stderr.push(line);
    });

    process.start();

    let writer = process.stdin.getWriter();
    const wholeDocument = new Range(0, editor.document.length);

    writer.write(editor.document.getTextInRange(wholeDocument));
    writer.close();

    let status = await new Promise(function (resolve, reject) {
        process.onDidExit(function (status) {
            resolve(status);
        })
    });

    if (status !== 0) {
        let err = stderr.join('');
        let request = new NotificationRequest('pipe-error');
        request.body = `${err}`;
        nova.notifications.add(request);
        return;
    }

    editor.edit(function (edit) {
        edit.replace(wholeDocument, stdout.join(''), InsertTextFormat.PlainText);
    });
}

exports.deactivate = function() {
    if (langserver) {
        langserver.deactivate();
        langserver = null;
    }
}


class CUELanguageServer {
    constructor() {
        // Observe the configuration setting for the server's location, and restart the server on change
        nova.config.observe('cue.language-server-path', function(path) {
            this.start(path);
        }, this);
    }

    deactivate() {
        this.stop();
    }

    start(path) {
        if (this.languageClient) {
            this.languageClient.stop();
            nova.subscriptions.remove(this.languageClient);
        }

        if (!path) {
            path = '/opt/homebrew/bin/cuepls';
        }

        var serverOptions = {
            path: path,
        };
        var clientOptions = {
            syntaxes: ['cue'],
            debug: nova.inDevMode(),
        };
        var client = new LanguageClient('cuepls', 'CUE Language Server', serverOptions, clientOptions);

        client.onDidStop(function(err) {
            if (!err) {
                return;
            }

            let request = new NotificationRequest('cuepls-error');
            request.body = `language server ${path} failed: ${err}`;
            nova.notifications.add(request);
        });

        try {
            client.start();
            nova.subscriptions.add(client);
            this.languageClient = client;
        }
        catch (err) {
            console.error(err);
        }
    }

    stop() {
        if (this.languageClient) {
            this.languageClient.stop();
            nova.subscriptions.remove(this.languageClient);
            this.languageClient = null;
        }
    }
}

