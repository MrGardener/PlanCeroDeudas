// Tailwind for the phone app: compiled ahead of time from the classes the app uses
// (the web version uses the Tailwind CDN with its default settings, so this stays default too).
module.exports = {
    content: ['../index.html', '../js/**/*.js'],
    theme: { extend: {} },
    plugins: []
};
