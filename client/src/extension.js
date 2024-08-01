/**
 * @param {import("vscode").ExtensionContext} context
 */
module.exports.activate = function (context) {
	console.log("I'm activated");

	context.subscriptions.push(
		commands.registerCommand("zvelte.restartLanguageServer", async () => {
			console.log("I'm working!!");
		}),
	);
};
