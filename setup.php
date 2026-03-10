<?php
// ============================================================
//  setup.php — 初回セットアップ（実行後にサーバーから削除してください）
// ============================================================

// ===== DB設定（api.php と同じ値を入力してください） =====
define('DB_HOST',   'mysql303b.xserver.jp');        // XserverのMySQLホスト名
define('DB_NAME',   'pha08069_client');             // Xserverのデータベース名
define('DB_USER',   'pha08069_user002');            // Xserverのデータベースユーザー名
define('DB_PASS',   'pswd0001');                    // Xserverのデータベースパスワード

// ===== 初期管理者アカウント =====
define('ADMIN_USERNAME',     'admin');
define('ADMIN_PASSWORD',     'admin1234');    // ← ログイン後すぐ変更してください
define('ADMIN_DISPLAY_NAME', '管理者');

// ============================================================

$errors  = [];
$success = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );

        // ユーザーテーブル
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS users (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                username      VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                display_name  VARCHAR(100) NOT NULL DEFAULT '',
                role          ENUM('admin','staff') NOT NULL DEFAULT 'staff',
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ");

        // CRMデータテーブル（全スタッフで1つのJSONを共有）
        $pdo->exec("
            CREATE TABLE IF NOT EXISTS crm_store (
                id         INT PRIMARY KEY DEFAULT 1,
                data       LONGTEXT NOT NULL,
                version    INT NOT NULL DEFAULT 1,
                updated_by INT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ");

        // 初期データ行を挿入（なければ）
        $pdo->exec("
            INSERT IGNORE INTO crm_store (id, data, version) VALUES (1, '[]', 1);
        ");

        // 初期管理者アカウントを作成（既存の場合はスキップ）
        $check = $pdo->prepare('SELECT id FROM users WHERE username = ?');
        $check->execute([ADMIN_USERNAME]);
        if (!$check->fetch()) {
            $pdo->prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')->execute([
                ADMIN_USERNAME,
                password_hash(ADMIN_PASSWORD, PASSWORD_DEFAULT),
                ADMIN_DISPLAY_NAME,
                'admin',
            ]);
        }

        $success = true;
    } catch (PDOException $e) {
        $errors[] = 'DB接続エラー: ' . $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>セットアップ — クライアント管理</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif; background: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
  .card { background: #fff; border-radius: 12px; padding: 40px 36px; box-shadow: 0 10px 25px rgba(0,0,0,.10); width: 100%; max-width: 500px; }
  .logo { display: flex; align-items: center; gap: 10px; font-size: 20px; font-weight: 700; color: #4f46e5; margin-bottom: 28px; justify-content: center; }
  h1 { font-size: 18px; font-weight: 700; color: #1f2937; margin-bottom: 20px; text-align: center; }
  .info  { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #1e40af; margin-bottom: 18px; line-height: 1.75; }
  .warn  { background: #fef9c3; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #78350f; margin-bottom: 18px; line-height: 1.75; }
  .error { background: #fee2e2; border: 1px solid #fca5a5; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #991b1b; margin-bottom: 18px; }
  .success { background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 18px; font-size: 14px; color: #065f46; margin-bottom: 18px; line-height: 1.8; }
  .btn { display: block; width: 100%; padding: 12px; border-radius: 8px; border: none; background: #4f46e5; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; transition: background .15s; }
  .btn:hover { background: #3730a3; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 13px; }
  td { padding: 8px 6px; border-bottom: 1px solid #e5e7eb; }
  td:first-child { color: #6b7280; width: 140px; }
  td:last-child { font-weight: 600; color: #1f2937; }
  code { background: #f3f4f6; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-family: monospace; }
  a { color: #4f46e5; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    クライアント管理
  </div>

  <h1>🔧 初回セットアップ</h1>

  <?php if ($success): ?>
    <div class="success">
      ✅ <strong>セットアップが完了しました！</strong><br><br>
      <strong>初期ログイン情報：</strong><br>
      ユーザー名: <code><?= htmlspecialchars(ADMIN_USERNAME) ?></code><br>
      パスワード: <code><?= htmlspecialchars(ADMIN_PASSWORD) ?></code><br><br>
      ⚠️ <strong>セキュリティのため、この <code>setup.php</code> ファイルをサーバーから今すぐ削除してください。</strong><br><br>
      👉 <a href="client-manager.html">client-manager.html</a> にアクセスしてログインしてください。
    </div>
  <?php else: ?>
    <div class="info">
      実行すると以下が作成されます：<br>
      ・ MySQLテーブル（users, crm_store）<br>
      ・ 初期管理者アカウント
    </div>

    <table>
      <tr><td>DB ソケット</td><td><?= htmlspecialchars(DB_SOCKET) ?></td></tr>
      <tr><td>DB 名</td><td><?= htmlspecialchars(DB_NAME) ?></td></tr>
      <tr><td>DB ユーザー</td><td><?= htmlspecialchars(DB_USER) ?></td></tr>
      <tr><td>初期管理者名</td><td><?= htmlspecialchars(ADMIN_USERNAME) ?></td></tr>
      <tr><td>初期パスワード</td><td><?= htmlspecialchars(ADMIN_PASSWORD) ?></td></tr>
    </table>

    <?php if ($errors): ?>
      <div class="error"><?= implode('<br>', array_map('htmlspecialchars', $errors)) ?></div>
    <?php endif; ?>

    <div class="warn">
      ⚠️ 実行前に <code>api.php</code> と <code>setup.php</code> 上部の DB設定（DB_HOST・DB_NAME・DB_USER・DB_PASS）を正しく入力してください。
    </div>

    <form method="post">
      <button class="btn" type="submit">セットアップを実行する</button>
    </form>
  <?php endif; ?>
</div>
</body>
</html>
