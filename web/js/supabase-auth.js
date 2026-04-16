// ============================================================
// Supabase Auth & Data Client
// ============================================================

const SUPABASE_URL = 'https://gbfzxxslkmgcrrvwjkow.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdiZnp4eHNsa21nY3Jydndqa293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyODYwMDUsImV4cCI6MjA5MTg2MjAwNX0.6SRptebB_cfhY7Wm1D88o3wHQAUnmZcOafVV2-R1GaY';

// Lightweight Supabase client (no npm dependency)
class SupabaseClient {
    constructor(url, key) {
        this.url = url;
        this.key = key;
        this.token = null;
        this.user = null;
        this._listeners = [];
    }

    _headers() {
        const h = {
            'apikey': this.key,
            'Content-Type': 'application/json',
        };
        if (this.token) h['Authorization'] = `Bearer ${this.token}`;
        return h;
    }

    async _fetch(path, options = {}) {
        const resp = await fetch(this.url + path, {
            ...options,
            headers: { ...this._headers(), ...options.headers },
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error_description || data.msg || data.message || 'API error');
        return data;
    }

    // ---- Auth ----
    async signUp(email, password, metadata = {}) {
        const data = await this._fetch('/auth/v1/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password, data: metadata }),
        });
        if (data.access_token) this._setSession(data);
        return data;
    }

    async signIn(email, password) {
        const data = await this._fetch('/auth/v1/token?grant_type=password', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
        });
        if (data.access_token) this._setSession(data);
        return data;
    }

    async signInWithOAuth(provider) {
        // Redirect-based OAuth
        const redirectTo = window.location.origin + window.location.pathname;
        window.location.href = `${this.url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(redirectTo)}`;
    }

    async signOut() {
        if (this.token) {
            try { await this._fetch('/auth/v1/logout', { method: 'POST' }); } catch(e) {}
        }
        this.token = null;
        this.user = null;
        localStorage.removeItem('sb_token');
        localStorage.removeItem('sb_refresh');
        this._notify();
    }

    async getSession() {
        const token = localStorage.getItem('sb_token');
        if (!token) return null;
        this.token = token;
        try {
            const data = await this._fetch('/auth/v1/user');
            this.user = data;
            this._notify();
            return data;
        } catch(e) {
            // Try refresh
            return this._refreshSession();
        }
    }

    async _refreshSession() {
        const refresh = localStorage.getItem('sb_refresh');
        if (!refresh) { this.token = null; return null; }
        try {
            const data = await this._fetch('/auth/v1/token?grant_type=refresh_token', {
                method: 'POST',
                body: JSON.stringify({ refresh_token: refresh }),
            });
            if (data.access_token) this._setSession(data);
            return this.user;
        } catch(e) {
            this.token = null;
            this.user = null;
            localStorage.removeItem('sb_token');
            localStorage.removeItem('sb_refresh');
            return null;
        }
    }

    _setSession(data) {
        this.token = data.access_token;
        this.user = data.user;
        localStorage.setItem('sb_token', data.access_token);
        if (data.refresh_token) localStorage.setItem('sb_refresh', data.refresh_token);
        this._notify();
    }

    // Check for OAuth callback hash
    async handleOAuthCallback() {
        const hash = window.location.hash;
        if (hash && hash.includes('access_token')) {
            // Immediately clean URL to prevent token leaking in browser history/cache
            window.history.replaceState(null, '', window.location.pathname);
            const params = new URLSearchParams(hash.substring(1));
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');
            if (access_token) {
                this._setSession({ access_token, refresh_token, user: null });
                await this.getSession();
                return true;
            }
        }
        return false;
    }

    onAuthStateChange(fn) { this._listeners.push(fn); }
    _notify() { this._listeners.forEach(fn => fn(this.user)); }

    // ---- Database ----
    async select(table, query = '') {
        return this._fetch(`/rest/v1/${table}?${query}`, { method: 'GET' });
    }

    async insert(table, data) {
        return this._fetch(`/rest/v1/${table}`, {
            method: 'POST',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(data),
        });
    }

    async update(table, match, data) {
        const query = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join('&');
        return this._fetch(`/rest/v1/${table}?${query}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=representation' },
            body: JSON.stringify(data),
        });
    }

    async upsert(table, data) {
        return this._fetch(`/rest/v1/${table}`, {
            method: 'POST',
            headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
            body: JSON.stringify(data),
        });
    }

    // ---- RPC (call server functions) ----
    async rpc(fnName, params = {}) {
        return this._fetch(`/rest/v1/rpc/${fnName}`, {
            method: 'POST',
            body: JSON.stringify(params),
        });
    }

    // ---- Realtime (SSE-based polling fallback) ----
    // Supabase Realtime needs WebSocket library, so we poll instead
    pollTable(table, intervalMs, callback) {
        let lastUpdated = '';
        const poll = async () => {
            try {
                const rows = await this.select(table, 'order=updated_at.desc&limit=1');
                if (rows && rows.length > 0) {
                    const ts = rows[0].updated_at;
                    if (ts !== lastUpdated) {
                        lastUpdated = ts;
                        callback(rows[0]);
                    }
                }
            } catch(e) { /* ignore poll errors */ }
        };
        poll(); // initial fetch
        return setInterval(poll, intervalMs);
    }

    stopPoll(intervalId) {
        clearInterval(intervalId);
    }
}

// Global instance
const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
