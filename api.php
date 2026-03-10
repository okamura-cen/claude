<?php
// ============================================================
//  api.php — クライアント管理 REST API
// ============================================================

// ===== DB設定（Xserverの管理パネルで確認してください） =====
define('DB_HOST',   'mysql303b.xserver.jp');        // XserverのMySQLホスト名
define('DB_NAME',   'pha08069_client');             // Xserverのデータベース名
define('DB_USER',   'pha08069_user002');            // Xserverのデータベースユーザー名
define('DB_PASS',   'pswd0001');                    // Xserverのデータベースパスワード
define('DB_CHARSET','utf8mb4');

// ============================================================

// セッション設定（httponly・SameSite で保護）
session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Strict',
]);
session_start();

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ===== DB接続（シングルトン） =====
function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    }
    return $pdo;
}

// ===== レスポンスヘルパー =====
function ok(array $data = []): void {
    echo json_encode(array_merge(['ok' => true], $data), JSON_UNESCAPED_UNICODE);
    exit;
}
function err(string $msg, int $code = 400): void {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

// ===== 認証チェック =====
function auth(): array {
    if (empty($_SESSION['user'])) err('ログインが必要です', 401);
    return $_SESSION['user'];
}
function admin_auth(): array {
    $u = auth();
    if ($u['role'] !== 'admin') err('管理者権限が必要です', 403);
    return $u;
}

// ===== リクエストボディ（JSON）取得 =====
function body(): array {
    static $b = null;
    if ($b === null) {
        $raw = file_get_contents('php://input');
        $b   = json_decode($raw, true) ?? [];
    }
    return $b;
}

// ===== ルーティング =====
$action = body()['action'] ?? ($_GET['action'] ?? '');

switch ($action) {
    case 'login':           handle_login();           break;
    case 'logout':          handle_logout();          break;
    case 'me':              handle_me();              break;
    case 'load':            handle_load();            break;
    case 'save':            handle_save();            break;
    case 'export':          handle_export();          break;
    case 'import':          handle_import();          break;
    case 'list_users':      handle_list_users();      break;
    case 'create_user':     handle_create_user();     break;
    case 'delete_user':     handle_delete_user();     break;
    case 'change_password': handle_change_password(); break;
    default:                err('不明なアクションです', 404);
}

// ============================================================
//  ハンドラ
// ============================================================

// ---- ログイン ----
function handle_login(): void {
    $b        = body();
    $username = trim($b['username'] ?? '');
    $password = $b['password'] ?? '';

    if (!$username || !$password) err('ユーザー名とパスワードを入力してください');

    $stmt = db()->prepare('SELECT id, username, password_hash, display_name, role FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        err('ユーザー名またはパスワードが違います', 401);
    }

    session_regenerate_id(true);
    $_SESSION['user'] = [
        'id'           => (int)$user['id'],
        'username'     => $user['username'],
        'display_name' => $user['display_name'],
        'role'         => $user['role'],
    ];
    ok(['user' => $_SESSION['user']]);
}

// ---- ログアウト ----
function handle_logout(): void {
    auth();
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
    }
    session_destroy();
    ok();
}

// ---- 自分の情報取得 ----
function handle_me(): void {
    if (empty($_SESSION['user'])) err('未ログイン', 401);
    ok(['user' => $_SESSION['user']]);
}

// ---- データ読み込み ----
function handle_load(): void {
    auth();
    $stmt = db()->prepare('SELECT data, version FROM crm_store WHERE id = 1');
    $stmt->execute();
    $row = $stmt->fetch();
    if (!$row) {
        ok(['data' => [], 'version' => 1]);
        return;
    }
    ok(['data' => json_decode($row['data'], true) ?? [], 'version' => (int)$row['version']]);
}

// ---- データ保存（楽観的ロック） ----
function handle_save(): void {
    $user    = auth();
    $b       = body();
    $data    = $b['data']    ?? null;
    $version = (int)($b['version'] ?? 0);

    if (!is_array($data)) err('dataが不正です');

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // FOR UPDATE でロック取得
        $stmt = $pdo->prepare('SELECT version FROM crm_store WHERE id = 1 FOR UPDATE');
        $stmt->execute();
        $row = $stmt->fetch();

        if ($row && (int)$row['version'] !== $version) {
            // バージョン不一致 → 競合エラー、最新データを返す
            $pdo->rollBack();
            $latest = $pdo->prepare('SELECT data, version FROM crm_store WHERE id = 1');
            $latest->execute();
            $l = $latest->fetch();
            http_response_code(409);
            echo json_encode([
                'ok'      => false,
                'conflict'=> true,
                'data'    => json_decode($l['data'], true),
                'version' => (int)$l['version'],
            ], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $newVersion = ($row ? (int)$row['version'] : 0) + 1;
        $json       = json_encode($data, JSON_UNESCAPED_UNICODE);

        if ($row) {
            $pdo->prepare('UPDATE crm_store SET data=?, version=?, updated_by=? WHERE id=1')
                ->execute([$json, $newVersion, $user['id']]);
        } else {
            $pdo->prepare('INSERT INTO crm_store (id, data, version, updated_by) VALUES (1,?,?,?)')
                ->execute([$json, $newVersion, $user['id']]);
        }

        $pdo->commit();
        ok(['version' => $newVersion]);

    } catch (Exception $e) {
        $pdo->rollBack();
        err('保存に失敗しました: ' . $e->getMessage(), 500);
    }
}

// ---- エクスポート（JSONダウンロード） ----
function handle_export(): void {
    auth();
    $stmt = db()->prepare('SELECT data FROM crm_store WHERE id = 1');
    $stmt->execute();
    $row  = $stmt->fetch();
    $data = $row ? $row['data'] : '[]';

    // JSON以外のContent-Typeに上書き
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="crm_export_' . date('Ymd_His') . '.json"');
    echo $data;
    exit;
}

// ---- インポート（adminのみ） ----
function handle_import(): void {
    $user = admin_auth();
    $b    = body();
    $data = $b['data'] ?? null;
    if (!is_array($data)) err('JSONデータが不正です');

    $json    = json_encode($data, JSON_UNESCAPED_UNICODE);
    $stmt    = db()->prepare('INSERT INTO crm_store (id, data, version, updated_by) VALUES (1,?,1,?) ON DUPLICATE KEY UPDATE data=VALUES(data), version=version+1, updated_by=VALUES(updated_by)');
    $stmt->execute([$json, $user['id']]);

    $v = db()->prepare('SELECT version FROM crm_store WHERE id=1');
    $v->execute();
    ok(['version' => (int)$v->fetch()['version']]);
}

// ---- ユーザー一覧（adminのみ） ----
function handle_list_users(): void {
    admin_auth();
    $stmt = db()->prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY id');
    $stmt->execute();
    ok(['users' => $stmt->fetchAll()]);
}

// ---- ユーザー作成（adminのみ） ----
function handle_create_user(): void {
    admin_auth();
    $b            = body();
    $username     = trim($b['username']     ?? '');
    $password     = $b['password']          ?? '';
    $display_name = trim($b['display_name'] ?? $username);
    $role         = in_array($b['role'] ?? '', ['admin','staff']) ? $b['role'] : 'staff';

    if (!$username)            err('ユーザー名を入力してください');
    if (strlen($password) < 6) err('パスワードは6文字以上にしてください');

    try {
        $stmt = db()->prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)');
        $stmt->execute([$username, password_hash($password, PASSWORD_DEFAULT), $display_name, $role]);
        ok(['id' => (int)db()->lastInsertId()]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') err('そのユーザー名はすでに使われています');
        err('作成に失敗しました', 500);
    }
}

// ---- ユーザー削除（adminのみ） ----
function handle_delete_user(): void {
    $me        = admin_auth();
    $target_id = (int)(body()['user_id'] ?? 0);
    if (!$target_id)                     err('ユーザーIDが不正です');
    if ($target_id === (int)$me['id'])   err('自分自身は削除できません');

    db()->prepare('DELETE FROM users WHERE id = ?')->execute([$target_id]);
    ok();
}

// ---- パスワード変更 ----
function handle_change_password(): void {
    $user = auth();
    $b    = body();
    $old  = $b['old_password'] ?? '';
    $new  = $b['new_password'] ?? '';

    if (strlen($new) < 6) err('新しいパスワードは6文字以上にしてください');

    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $row  = $stmt->fetch();

    if (!$row || !password_verify($old, $row['password_hash'])) err('現在のパスワードが違います');

    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
    ok();
}
