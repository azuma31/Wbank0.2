// ローディング状態を管理するクラス
class LoadingManager {
    constructor() {
        this.activePromises = new Set();
        this.loadingElement = document.getElementById('loading');
        this.messageElement = document.querySelector('.loading-content p');
    }

    async showLoading(promise, message = '処理中...', minDuration = 1000) {
        this.messageElement.textContent = message;
        this.loadingElement.classList.remove('hidden');

        const startTime = Date.now();
        this.activePromises.add(promise);

        try {
            const result = await promise;
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, minDuration - elapsed);

            if (remaining > 0) {
                await new Promise(resolve => setTimeout(resolve, remaining));
            }

            return result;
        } finally {
            this.activePromises.delete(promise);
            if (this.activePromises.size === 0) {
                this.loadingElement.classList.add('hidden');
            }
        }
    }

    isLoading() {
        return this.activePromises.size > 0;
    }
}

// グローバルインスタンスとステート
const loadingManager = new LoadingManager();
let currentUser = null;
let transactions = [];
let pendingPayment = null;
let updateInterval = null;
const STORAGE_KEY = 'w_wallet_user';

// API呼び出し関数
async function callApi(action, data, showLoadingIndicator = true) {
    const apiCall = async () => {
        const formData = new URLSearchParams();
        formData.append('action', action);
        formData.append('data', JSON.stringify(data));

        const url = ['checkPin', 'setPin', 'verifyPin'].includes(action) ? PIN_API_URL : API_URL;

        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '予期せぬエラーが発生しました');
        }
        return result.data;
    };

    if (showLoadingIndicator) {
        return loadingManager.showLoading(apiCall());
    } else {
        return apiCall();
    }
}

// メッセージ表示関数
function showMessage(message, isError = false) {
    const messageEl = document.getElementById('message');
    const messageText = document.getElementById('message-text');
    messageEl.classList.remove('hidden');
    messageEl.style.backgroundColor = isError ? 'var(--danger)' : 'var(--success)';
    messageText.textContent = message;
    setTimeout(() => {
        messageEl.classList.add('hidden');
    }, 3000);
}

// 自動ログイン
(async function autoLogin() {
    const savedUser = localStorage.getItem(STORAGE_KEY);
    const params = getUrlParams();

    // URL決済パラメータがある場合は必ず自動ログインを試みる
    if (params.from && savedUser) {
        try {
            const loginPromise = async () => {
                const userData = JSON.parse(savedUser);
                const updatedUser = await callApi('login', {
                    username: userData.username,
                    password: userData.password
                }, false);
                currentUser = { ...updatedUser, password: userData.password };
                await handlePostLogin();
            };
            await loadingManager.showLoading(loginPromise(), '自動ログイン中...');
        } catch (error) {
            console.error('Auto login failed:', error);
            showLogin();
        }
    } else if (savedUser && !localStorage.getItem('manual_logout')) {
        // 通常の自動ログイン（手動ログアウトされていない場合のみ）
        try {
            const loginPromise = async () => {
                const userData = JSON.parse(savedUser);
                const updatedUser = await callApi('login', {
                    username: userData.username,
                    password: userData.password
                }, false);
                currentUser = { ...updatedUser, password: userData.password };
                await handlePostLogin();
            };
            await loadingManager.showLoading(loginPromise(), '自動ログイン中...');
        } catch (error) {
            console.error('Auto login failed:', error);
            localStorage.removeItem(STORAGE_KEY);
            showLogin();
        }
    } else {
        showLogin();
    }
})();

// URL処理
function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        from: params.get('from')
    };
}

// 画面表示制御
function hideAllForms() {
    const forms = ['login-form', 'register-form', 'pin-auth-form', 'payment-form', 'dashboard'];
    forms.forEach(formId => {
        document.getElementById(formId).classList.add('hidden');
    });
}

function updateNavButtons() {
    const usernameDisplay = document.getElementById('username-display');
    const logoutButton = document.getElementById('logout-button');

    if (currentUser) {
        usernameDisplay.textContent = currentUser.username;
        usernameDisplay.classList.remove('hidden');
        logoutButton.classList.remove('hidden');
    } else {
        usernameDisplay.classList.add('hidden');
        logoutButton.classList.add('hidden');
    }
}

function showLogin() {
    stopAutoUpdate();
    hideAllForms();
    document.getElementById('login-form').classList.remove('hidden');
    updateNavButtons();
}

function showRegister() {
    stopAutoUpdate();
    hideAllForms();
    document.getElementById('register-form').classList.remove('hidden');
    updateNavButtons();
}

function showPinAuth() {
    hideAllForms();
    document.getElementById('pin-auth-form').classList.remove('hidden');
    updateNavButtons();
}

function showPayment(fromAccountId) {
    hideAllForms();
    document.getElementById('payment-form').classList.remove('hidden');
    document.getElementById('payer-name').textContent = fromAccountId;
    updateNavButtons();
}

function showDashboard() {
    hideAllForms();
    document.getElementById('dashboard').classList.remove('hidden');
    updateDashboard();
    updateNavButtons();
    startAutoUpdate();
}

// アカウント管理
async function handleRegister(event) {
    event.preventDefault();
    const formData = {
        username: document.getElementById('register-username').value,
        password: document.getElementById('register-password').value,
        confirmPassword: document.getElementById('register-confirm-password').value,
        pin: document.getElementById('register-pin').value,
        confirmPin: document.getElementById('register-confirm-pin').value
    };

    try {
        if (formData.password !== formData.confirmPassword) {
            throw new Error('パスワードが一致しません');
        }

        if (formData.pin !== formData.confirmPin) {
            throw new Error('PINコードが一致しません');
        }

        if (!/^\d{4}$/.test(formData.pin)) {
            throw new Error('PINコードは4桁の数字で入力してください');
        }

        const registerPromise = async () => {
            const result = await callApi('register', {
                username: formData.username,
                password: formData.password
            });

            await callApi('setPin', {
                accountId: result.accountId,
                pin: formData.pin
            });
        };

        await loadingManager.showLoading(registerPromise(), 'アカウント作成中...');

        showMessage('アカウントが作成されました。ログインしてください。');
        showLogin();
        event.target.reset();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;

    try {
        const loginPromise = async () => {
            const userData = await callApi('login', { username, password });
            currentUser = { ...userData, password };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(currentUser));
            // ログイン成功時に手動ログアウトフラグを削除
            localStorage.removeItem('manual_logout');
            await handlePostLogin();
        };

        await loadingManager.showLoading(loginPromise(), 'ログイン中...');
        showMessage(`ようこそ、${username}さん`);
        event.target.reset();
    } catch (error) {
        showMessage(error.message, true);
    }
}

async function handlePostLogin() {
    try {
        const initPromise = async () => {
            transactions = await callApi('getTransactions', {
                accountId: currentUser.accountId
            }, false);

            const params = getUrlParams();
            if (params.from) {
                await handleURLPayment();
            } else {
                showDashboard();
            }
        };

        await loadingManager.showLoading(initPromise(), 'データ読み込み中...');
    } catch (error) {
        showMessage(error.message, true);
        showLogin();
    }
}

function handleLogout() {
    stopAutoUpdate();
    currentUser = null;
    transactions = [];

    const params = getUrlParams();
    if (!params.from) {
        // URL決済でない通常のログアウト時は手動ログアウトフラグを設定
        localStorage.setItem('manual_logout', 'true');
        localStorage.removeItem(STORAGE_KEY);
    }

    showLogin();
    showMessage('ログアウトしました');

    // URL決済の場合はパラメータを維持、それ以外は通常のパスに戻す
    if (!params.from) {
        window.location.href = window.location.pathname;
    }
}

// URL決済の初期処理
async function handleURLPayment() {
    const params = getUrlParams();

    try {
        if (!currentUser) {
            throw new Error('ログインが必要です');
        }

        if (!params.from) {
            throw new Error('送金元が指定されていません');
        }

        // PIN状態の確認 - 送金元アカウントのPINを確認
        const checkPinPromise = async () => {
            const pinResult = await callApi('checkPin', {
                accountId: params.from
            }, false);

            if (!pinResult.hasPin) {
                throw new Error('送金元アカウントのPINが設定されていません');
            }

            // PIN確認が成功したら一時的な決済情報を設定
            pendingPayment = {
                fromAccountId: params.from,
                toAccountId: currentUser.accountId,
                amount: null // この時点では金額未設定
            };
        };

        await loadingManager.showLoading(checkPinPromise(), 'PIN確認中...');
        showPinAuth(); // PIN認証画面を表示
    } catch (error) {
        showMessage(error.message, true);
        // エラーが発生した場合はダッシュボードに戻る
        setTimeout(() => {
            window.location.href = window.location.pathname;
        }, 2000);
    }
}

// PIN認証の処理
async function handlePinAuth(event) {
    event.preventDefault();
    const pin = document.getElementById('pin-auth').value;

    try {
        if (!pendingPayment) {
            throw new Error('送金情報が見つかりません');
        }

        const verifyPinPromise = async () => {
            // PIN認証
            const verifyResult = await callApi('verifyPin', {
                accountId: pendingPayment.fromAccountId,
                pin: pin
            }, false);

            if (!verifyResult.success) {
                throw new Error('PINコードが正しくありません');
            }
        };

        await loadingManager.showLoading(verifyPinPromise(), 'PIN認証中...');

        // PIN認証成功後、金額入力画面を表示
        document.getElementById('pin-auth').value = ''; // PIN入力をクリア
        showPayment(pendingPayment.fromAccountId);
    } catch (error) {
        showMessage(error.message, true);
        document.getElementById('pin-auth').value = '';
    }
}

// キャンセル処理
function handleCancel() {
    pendingPayment = null;
    window.location.href = window.location.pathname;
}

// 金額入力後の送金処理
async function handlePayment(event) {
    event.preventDefault();
    const amount = parseInt(document.getElementById('payment-amount').value);

    try {
        if (!pendingPayment) {
            throw new Error('送金情報が見つかりません');
        }

        if (amount <= 0) {
            throw new Error('送金額は1W以上を指定してください');
        }

        // 金額を設定して送金実行
        pendingPayment.amount = amount;

        const transferPromise = async () => {
            const result = await callApi('transfer', pendingPayment);

            // 残高とトランザクション履歴の更新
            currentUser.balance = result.newBalance;
            transactions = await callApi('getTransactions', {
                accountId: currentUser.accountId
            }, false);
        };

        await loadingManager.showLoading(transferPromise(), '送金処理中...');

        showMessage('送金が完了しました');
        pendingPayment = null;

        // ダッシュボードに戻る
        setTimeout(() => {
            window.location.href = window.location.pathname;
        }, 2000);
    } catch (error) {
        showMessage(error.message, true);
    }
}

// 通常送金処理
async function handleTransfer(event) {
    event.preventDefault();
    const toAccountId = document.getElementById('transfer-to').value;
    const amount = parseInt(document.getElementById('transfer-amount').value);

    try {
        if (!currentUser) {
            throw new Error('ログインが必要です');
        }

        if (toAccountId === currentUser.accountId) {
            throw new Error('自分自身には送金できません');
        }

        if (amount <= 0) {
            throw new Error('送金額は1W以上を指定してください');
        }

        if (amount > currentUser.balance) {
            throw new Error('残高が不足しています');
        }

        const transferPromise = async () => {
            const result = await callApi('transfer', {
                fromAccountId: currentUser.accountId,
                toAccountId,
                amount
            });

            currentUser.balance = result.newBalance;
            transactions = await callApi('getTransactions', {
                accountId: currentUser.accountId
            }, false);
        };

        await loadingManager.showLoading(transferPromise(), '送金処理中...');
        showMessage('送金が完了しました');
        showDashboard();
    } catch (error) {
        showMessage(error.message, true);
    }
}

// 自動更新
function startAutoUpdate() {
    stopAutoUpdate();
    updateInterval = setInterval(async () => {
        if (currentUser) {
            try {
                const updatePromise = async () => {
                    const userData = await callApi('login', {
                        username: currentUser.username,
                        password: currentUser.password
                    }, false);
                    currentUser = { ...userData, password: currentUser.password };
                    transactions = await callApi('getTransactions', {
                        accountId: currentUser.accountId
                    }, false);
                    updateDashboard(true);
                };
                await updatePromise();
            } catch (error) {
                console.error('Auto-update error:', error);
            }
        }
    }, 10000);
}

function stopAutoUpdate() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// ダッシュボード更新
function updateDashboard(isAutoUpdate = false) {
    if (!currentUser) return;

    document.getElementById('balance').textContent = currentUser.balance.toLocaleString();
    document.getElementById('account-id').textContent = currentUser.accountId;
    document.getElementById('username').textContent = currentUser.username;

    const transactionsList = document.getElementById('transactions');
    transactionsList.innerHTML = '';

    if (transactions.length === 0) {
        transactionsList.innerHTML = '<div class="transaction-item">取引履歴がありません</div>';
        return;
    }

    transactions.forEach(transaction => {
        const div = document.createElement('div');
        div.className = 'transaction-item';

        const isReceived = transaction.toAccountId === currentUser.accountId;
        const amount = transaction.amount.toLocaleString();
        const date = new Date(transaction.date).toLocaleString('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });

        div.innerHTML = `
            <div class="transaction-details">
                <span class="transaction-date">${date}</span>
                <span class="transaction-amount ${isReceived ? 'received' : 'sent'}">
                    ${isReceived ? '+' : '-'}${amount} W
                </span>
            </div>
            <div class="transaction-party">
                ${isReceived ? '送金元' : '送金先'}: 
                ${isReceived ? transaction.fromName : transaction.toName}
                (${isReceived ? transaction.fromAccountId : transaction.toAccountId})
            </div>
        `;

        transactionsList.appendChild(div);
    });
}

// アカウントID関連
function copyAccountId() {
    const accountId = document.getElementById('account-id').textContent;
    navigator.clipboard.writeText(accountId)
        .then(() => showMessage('アカウントIDをコピーしました'))
        .catch(() => showMessage('コピーに失敗しました', true));
}

// 入力制限の設定
document.addEventListener('DOMContentLoaded', () => {
    // PIN入力フィールドの数字のみ入力制限
    const pinInputs = document.querySelectorAll('input[pattern="\\d{4}"]');
    pinInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
        });
    });

    // 送金額の入力制限
    const amountInputs = document.querySelectorAll('input[type="number"]');
    amountInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            if (value < 0) {
                e.target.value = 0;
            }
        });
    });

    // フォームのバリデーション設定
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const inputs = form.querySelectorAll('input[required]');
        inputs.forEach(input => {
            input.addEventListener('input', () => {
                validateInput(input);
            });
        });
    });
});

// 入力バリデーション
function validateInput(input) {
    if (input.pattern) {
        const regex = new RegExp(input.pattern);
        if (!regex.test(input.value)) {
            input.classList.add('invalid');
        } else {
            input.classList.remove('invalid');
        }
    } else if (input.required && !input.value) {
        input.classList.add('invalid');
    } else {
        input.classList.remove('invalid');
    }
}

// グローバルエラーハンドリング
window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    if (!loadingManager.isLoading()) {
        showMessage('エラーが発生しました', true);
    }
});

window.onerror = function (message, source, line, column, error) {
    console.error('Global error:', { message, source, line, column, error });
    if (!loadingManager.isLoading()) {
        showMessage('エラーが発生しました', true);
    }
    return false;
};

// ネットワーク状態の監視
window.addEventListener('online', () => {
    showMessage('ネットワーク接続が回復しました');
    if (currentUser) {
        startAutoUpdate();
    }
});

window.addEventListener('offline', () => {
    showMessage('ネットワーク接続が切断されました', true);
    stopAutoUpdate();
});