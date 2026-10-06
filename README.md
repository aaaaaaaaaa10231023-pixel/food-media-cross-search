# 食品・メディアサイト 横断検索（公開版）

1つのキーワードを、複数の食品・メディアサイトに対して横断検索するNode.js Webアプリです。

## 公開版の構成

- Webホスティング：Render
- 検索API：Brave Search API
- ブラウザからURLを開いて利用
- Brave APIキーはサーバー側の環境変数に保存し、ブラウザには公開しません

## 対応媒体

- 食品新聞：shokuhin.net
- 日本食糧新聞：nissyoku.co.jp
- 日経クロストレンド：xtrend.nikkei.com
- 料理王国：cuisine-kingdom.com
- dancyu：dancyu.jp
- オレンジページ：orangepage.net
- macaroni：macaro-ni.jp
- 食べログマガジン：magazine.tabelog.com
- PR TIMES：prtimes.jp
- ELLEグルメ：elle.com/jp/gourmet
- ufu：ufu-sweets.jp
- ファッションプレス：fashion-press.net

## Renderで公開する手順

1. このフォルダをGitHubのリポジトリにアップロードします。
2. Renderで「New → Web Service」を選択します。
3. GitHubリポジトリを接続します。
4. 設定は以下です。
   - Language / Runtime：Node
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Plan：Free
5. Environment Variablesに以下を設定します。
   - `BRAVE_API_KEY`：Brave Search APIのAPIキー
   - `MAX_API_REQUESTS`：`1000`
6. Create Web Serviceを押すと、`https://xxxxx.onrender.com` の公開URLが発行されます。

## 重要：料金保護

このアプリにはアプリ内のAPIリクエスト上限があります。ただし、Renderの無料インスタンスは再起動するとメモリ上のカウンターがリセットされるため、これだけを「課金防止」の唯一の仕組みにしないでください。

Brave Search API側でもUsage Limitを設定してください。Brave Search APIはSearchが$5/1,000 requestsで、毎月$5の無料クレジットがあります。無料範囲だけで使う場合は、Brave側の利用上限・プリペイド設定を必ず確認してください。

## ローカル起動

```bash
npm start
```

ブラウザで `http://localhost:3000` を開きます。

## 注意

検索結果はBrave Search APIの結果を利用しています。各媒体のrobots.txt、利用規約、著作権・転載条件等に従って利用してください。
