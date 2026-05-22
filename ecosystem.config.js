module.exports = {
    apps: [
        {
            name: "control",
            script: "./control.js",
            env: {
                "CONTROL_TOKEN": "SuperSecretToken123456"
            }
        },
        {
            name: "meetgay",
            script: "./server.js",
            env: {
                "NODE_ENV": "production"
            }
        }
    ]
}