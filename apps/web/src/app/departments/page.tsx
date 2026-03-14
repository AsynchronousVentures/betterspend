'use client';

import { useEffect, useState } from 'react';
import { FolderTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const EMPTY_FORM = { name: '', code: '', parentId: '' };

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setDepartments(await api.departments.list());
    } catch (err: any) {
      setError(err.message ?? 'Unable to load departments.');
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = { name: form.name, code: form.code, parentId: form.parentId || undefined };
      if (editingId) {
        await api.departments.update(editingId, payload);
      } else {
        await api.departments.create(payload);
      }
      resetForm();
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this department?')) return;
    try {
      await api.departments.remove(id);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startEdit(department: any) {
    setForm({ name: department.name, code: department.code, parentId: department.parentId || '' });
    setEditingId(department.id);
    setShowForm(true);
  }

  const deptById = Object.fromEntries(departments.map((department) => [department.id, department]));

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Departments"
        description="Maintain budget centers and reporting hierarchies for approval routing, project ownership, and org visibility."
        actions={
          <Button
            type="button"
            onClick={() => {
              setError('');
              setShowForm(true);
              setEditingId(null);
              setForm(EMPTY_FORM);
            }}
          >
            <Plus className="h-4 w-4" />
            New Department
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">{editingId ? 'Edit department' : 'Department details'}</CardTitle>
            <CardDescription>Create new teams, assign parent departments, and keep codes aligned with ERP exports.</CardDescription>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <div className="space-y-5">
                <div className="grid gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Name</label>
                    <Input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Engineering" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                    <Input value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} placeholder="ENG" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Parent Department</label>
                    <Select value={form.parentId} onChange={(event) => setField('parentId', event.target.value)} className="w-full">
                      <option value="">None</option>
                      {departments
                        .filter((department) => department.id !== editingId)
                        .map((department) => (
                          <option key={department.id} value={department.id}>
                            {department.name} ({department.code})
                          </option>
                        ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={saving || !form.name || !form.code} onClick={handleSave}>
                    <Plus className="h-4 w-4" />
                    {saving ? 'Saving...' : editingId ? 'Update Department' : 'Save Department'}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <FolderTree className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Ready for the next org change</div>
                <p className="mt-2 text-sm text-muted-foreground">Open the form to create a new department or edit an existing one from the registry.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-xl">Department registry</CardTitle>
            <CardDescription>See the current parent-child hierarchy and quickly clean up outdated org units.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading departments...
              </div>
            ) : departments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No departments yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {departments.map((department) => (
                    <TableRow key={department.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{department.name}</div>
                      </TableCell>
                      <TableCell>
                        <code className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">{department.code}</code>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {department.parentId ? deptById[department.parentId]?.name || department.parentId : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => startEdit(department)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => handleDelete(department.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
