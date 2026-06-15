'use client';

import { useState, useEffect } from 'react';


interface User {
  id: string;
  username: string;
  name: string | null;
  email: string | null;
  role: string;
  accessTradePayable?: boolean;
  accessTradeReceivable?: boolean;
  accessConfirmMsme?: boolean;
  createdAt: string;
}

export default function UsersClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      setUsers(data.users || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete user "${user.username}"? This will also remove all their data.`)) return;
    setDeletingId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (res.ok) fetchUsers();
      else { const d = await res.json(); alert(d.error || 'Failed to delete'); }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">Add, edit, or remove users from the system</p>
        </div>
        <button
          onClick={() => { setEditUser(null); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 transition-colors shadow-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add User
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-neutral-900 border-t-transparent rounded-full" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Username</th>
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Name</th>
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Email</th>
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Role</th>
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Modules</th>
                <th className="text-left px-5 py-3.5 text-gray-600 font-semibold">Created</th>
                <th className="text-right px-5 py-3.5 text-gray-600 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-gray-900">{u.username}</td>
                  <td className="px-5 py-3.5 text-gray-600">{u.name || '—'}</td>
                  <td className="px-5 py-3.5 text-gray-600">{u.email || '—'}</td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                      u.role === 'admin'
                        ? 'bg-neutral-100 text-neutral-800 border border-neutral-200'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {u.role === 'admin' ? 'Admin' : 'User'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-600 text-xs">
                    {u.role === 'admin' ? (
                      <span className="text-gray-400">All</span>
                    ) : (
                      <span>
                        {[u.accessTradePayable !== false ? 'Payables' : null,
                          u.accessTradeReceivable !== false ? 'Receivables' : null,
                          u.accessConfirmMsme !== false ? 'MSME' : null]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs">
                    {new Date(u.createdAt).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setEditUser(u); setShowAdd(true); }}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-800 border border-neutral-200 rounded-lg hover:bg-neutral-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={deletingId === u.id}
                        className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      >
                        {deletingId === u.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-gray-400">
                    No users found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && (
        <UserModal
          user={editUser}
          onClose={() => { setShowAdd(false); setEditUser(null); }}
          onSaved={() => { setShowAdd(false); setEditUser(null); fetchUsers(); }}
        />
      )}
    </div>
  );
}

function UserModal({
  user,
  onClose,
  onSaved,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username || '');
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'user');
  const [accessTp, setAccessTp] = useState(user?.accessTradePayable !== false);
  const [accessTr, setAccessTr] = useState(user?.accessTradeReceivable !== false);
  const [accessMsme, setAccessMsme] = useState(user?.accessConfirmMsme !== false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccessTp(user?.accessTradePayable !== false);
    setAccessTr(user?.accessTradeReceivable !== false);
    setAccessMsme(user?.accessConfirmMsme !== false);
    setRole(user?.role || 'user');
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const url = isEdit ? `/api/users/${user!.id}` : '/api/users';
      const method = isEdit ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        name,
        email,
        role,
        accessTradePayable: role === 'admin' ? true : accessTp,
        accessTradeReceivable: role === 'admin' ? true : accessTr,
        accessConfirmMsme: role === 'admin' ? true : accessMsme,
      };
      if (!isEdit) (body as Record<string, unknown>).username = username;
      if (password) (body as Record<string, unknown>).password = password;

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to save');
        return;
      }

      onSaved();
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEdit ? 'Edit User' : 'Add New User'}
          </h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/25"
                placeholder="e.g. john.doe"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/25"
              placeholder="e.g. John Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/25"
              placeholder="e.g. john@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isEdit ? 'New Password (leave blank to keep)' : 'Password *'}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!isEdit}
              minLength={4}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/25"
              placeholder={isEdit ? '••••••••' : 'Min 12 chars, upper, lower, digit'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/25 bg-white"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {role === 'user' && (
            <div className="space-y-3 rounded-xl border border-gray-100 p-4 bg-gray-50">
              <p className="text-sm font-medium text-gray-700">Module access</p>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={accessTp}
                  onChange={(e) => setAccessTp(e.target.checked)}
                  className="rounded border-gray-300 text-neutral-800 focus:ring-neutral-900/25"
                />
                Trade Payables
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={accessTr}
                  onChange={(e) => setAccessTr(e.target.checked)}
                  className="rounded border-gray-300 text-neutral-800 focus:ring-neutral-900/25"
                />
                Trade Receivables
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={accessMsme}
                  onChange={(e) => setAccessMsme(e.target.checked)}
                  className="rounded border-gray-300 text-neutral-800 focus:ring-neutral-900/25"
                />
                Confirm MSME
              </label>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-neutral-900 text-white text-sm font-medium rounded-xl hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
