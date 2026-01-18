const { watch } = require('fs');
const path = require('path');

module.exports = {
  files: [
    'docs/**/*.html',
    'docs/**/*.css',
    'docs/**/*.js',
  ],
  startPath: '/',
  watch: true,
  open: 'external',
  server: {
    baseDir: 'docs',
    https: true,
  },
  notify: false,
};