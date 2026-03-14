'use client';

import { PageHeader } from '../../components/page-header';
import { AccountProfileForm } from '../../components/account-profile-form';

export default function ProfilePage() {
  return (
    <div className="space-y-6 p-4 lg:p-8">
      <PageHeader
        title="Profile"
        description="Manage your personal account details, photo, email, and password."
      />
      <AccountProfileForm />
    </div>
  );
}
