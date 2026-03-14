'use client';

import { useEffect, useState } from 'react';
import { FolderKanban, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/page-header';
import { StatusBadge } from '../../components/status-badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const EMPTY_FORM = {
  name: '',
  code: '',
  departmentId: '',
  status: 'active',
  startDate: '',
  endDate: '',
};

const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'];

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.projects.list(), api.departments.list()])
      .then(([projectData, departmentData]) => {
        setProjects(projectData);
        setDepartments(departmentData);
      })
      .catch((err: any) => {
        setError(err.message ?? 'Unable to load projects.');
      })
      .finally(() => setLoading(false));
  }, []);

  async function loadProjects() {
    setProjects(await api.projects.list());
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function setField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        code: form.code,
        departmentId: form.departmentId || undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      };

      if (editingId) {
        await api.projects.update(editingId, payload);
      } else {
        await api.projects.create(payload);
      }

      setShowForm(false);
      setEditingId(null);
      resetForm();
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this project?')) return;
    try {
      await api.projects.remove(id);
      await loadProjects();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startEdit(project: any) {
    setForm({
      name: project.name,
      code: project.code,
      departmentId: project.departmentId || '',
      status: project.status || 'active',
      startDate: project.startDate ? project.startDate.slice(0, 10) : '',
      endDate: project.endDate ? project.endDate.slice(0, 10) : '',
    });
    setEditingId(project.id);
    setShowForm(true);
  }

  const departmentMap = Object.fromEntries(departments.map((department) => [department.id, department]));

  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Projects"
        description="Track initiative-level ownership, time windows, and the operating status that approval rules and budget reporting depend on."
        actions={
          <Button
            type="button"
            onClick={() => {
              setShowForm(true);
              setEditingId(null);
              resetForm();
            }}
          >
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)]">
        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">{editingId ? 'Edit project' : 'Project details'}</CardTitle>
            <CardDescription>Keep department ownership, lifecycle dates, and status labels consistent for every tracked project.</CardDescription>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <div className="space-y-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
                  <div className="md:col-span-2 xl:col-span-1">
                    <label className="mb-2 block text-sm font-medium text-foreground">Name</label>
                    <Input value={form.name} onChange={(event) => setField('name', event.target.value)} placeholder="Global ERP Rollout" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Code</label>
                    <Input value={form.code} onChange={(event) => setField('code', event.target.value.toUpperCase())} placeholder="PROJ-001" />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Department</label>
                    <Select value={form.departmentId} onChange={(event) => setField('departmentId', event.target.value)} className="w-full">
                      <option value="">None</option>
                      {departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Status</label>
                    <Select value={form.status} onChange={(event) => setField('status', event.target.value)} className="w-full">
                      {PROJECT_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status.replace('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Start date</label>
                    <Input type="date" value={form.startDate} onChange={(event) => setField('startDate', event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">End date</label>
                    <Input type="date" value={form.endDate} onChange={(event) => setField('endDate', event.target.value)} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" disabled={saving || !form.name || !form.code} onClick={handleSave}>
                    <Plus className="h-4 w-4" />
                    {saving ? 'Saving...' : editingId ? 'Update Project' : 'Save Project'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false);
                      setError('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
                <FolderKanban className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">Project setup is ready</div>
                <p className="mt-2 text-sm text-muted-foreground">Open the form to add a new initiative or edit an existing status and timeline.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[24px]">
          <CardHeader>
            <CardTitle className="text-xl">Project portfolio</CardTitle>
            <CardDescription>Review current ownership, watch for stale timelines, and clean up inactive or cancelled workstreams.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                Loading projects...
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center text-sm text-muted-foreground">
                No projects yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{project.name}</div>
                      </TableCell>
                      <TableCell>
                        <code className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">{project.code}</code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {project.departmentId ? departmentMap[project.departmentId]?.name || '—' : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge value={project.status || 'inactive'} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'}
                        {project.endDate ? ` -> ${new Date(project.endDate).toLocaleDateString()}` : ''}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => startEdit(project)}>
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => handleDelete(project.id)}>
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
