/**
 * Content Script: ページコンテキストに inject.ts のコードを注入する
 * Content Script は隔離された JS 環境で動くため、
 * Polymer の内部データにアクセスするにはページコンテキストで実行する必要がある
 */
const script = document.createElement("script");
script.src = chrome.runtime.getURL("dist/inject.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);
