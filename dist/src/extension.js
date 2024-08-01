module.exports.activate=function(e){console.log("I'm activated"),e.subscriptions.push(commands.registerCommand("zvelte.restartLanguageServer",async()=>{console.log("I'm working!!")}))};
