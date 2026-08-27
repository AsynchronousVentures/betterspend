-- Move the original Acme fixture off its pre-UUID numeric-looking IDs.
-- Parents are cloned first, then foreign-key references move to the clones.
-- This keeps non-deferrable constraints valid throughout the migration.

-- Workflow documents have a few nested resolver references. This remaps only
-- exact userId values, never free-form strings or arbitrary JSON keys.
CREATE OR REPLACE FUNCTION pg_temp.remap_workflow_resolver_user_id(
  document jsonb,
  old_id text,
  new_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STRICT
AS $function$
BEGIN
  CASE jsonb_typeof(document)
    WHEN 'object' THEN
      RETURN COALESCE(
        (
          SELECT jsonb_object_agg(
            entry.key,
            CASE
              WHEN entry.key = 'userId' AND entry.value = to_jsonb(old_id) THEN to_jsonb(new_id)
              ELSE pg_temp.remap_workflow_resolver_user_id(entry.value, old_id, new_id)
            END
          )
          FROM jsonb_each(document) AS entry(key, value)
        ),
        '{}'::jsonb
      );
    WHEN 'array' THEN
      RETURN COALESCE(
        (
          SELECT jsonb_agg(pg_temp.remap_workflow_resolver_user_id(entry.value, old_id, new_id))
          FROM jsonb_array_elements(document) AS entry(value)
        ),
        '[]'::jsonb
      );
    ELSE
      RETURN document;
  END CASE;
END;
$function$;

DO $migration$
DECLARE
  legacy_org uuid := '00000000-0000-0000-0000-000000000001';
  migrated_org uuid;
  table_record record;
  column_record record;
  map_record record;
  uuid_cases text;
  uuid_where text;
  source_identity_tables text[] := ARRAY[
    'organizations',
    'legal_entities',
    'departments',
    'users',
    'vendors',
    'user_roles'
  ];
BEGIN
  -- New installations and already-upgraded installations do not need this
  -- data rewrite. In particular, this does not inspect or alter other tenants.
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = legacy_org) THEN
    RETURN;
  END IF;

  -- These checks keep a reused legacy ID from being silently reassigned after
  -- somebody has changed the fixture's natural identity.
  IF EXISTS (
    SELECT 1
    FROM organizations
    WHERE id = legacy_org
      AND (slug IS DISTINCT FROM 'acme-corp' OR name IS DISTINCT FROM 'Acme Corp')
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy organization natural key does not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR email IS DISTINCT FROM 'admin@acme.com'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy administrator natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE id = '00000000-0000-0000-0000-000000000003'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR email IS DISTINCT FROM 'requester@acme.com'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy requester natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM users
    WHERE id = '00000000-0000-0000-0000-000000000004'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR email IS DISTINCT FROM 'approver@acme.com'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy approver natural key does not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM departments
    WHERE id = '00000000-0000-0000-0000-000000000010'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR code IS DISTINCT FROM 'ENG'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy engineering department natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM departments
    WHERE id = '00000000-0000-0000-0000-000000000011'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR code IS DISTINCT FROM 'MKT'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy marketing department natural key does not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM legal_entities
    WHERE id = '00000000-0000-0000-0000-000000000020'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR code IS DISTINCT FROM 'ACME-HQ'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy legal-entity natural key does not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM vendors
    WHERE id = '00000000-0000-0000-0000-000000000030'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR code IS DISTINCT FROM 'ACME-SUP'
        OR entity_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000020'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy Acme Supplies natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM vendors
    WHERE id = '00000000-0000-0000-0000-000000000031'
      AND (
        organization_id IS DISTINCT FROM legacy_org
        OR code IS DISTINCT FROM 'TECHPARTS'
        OR entity_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000020'
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy TechParts natural key does not match';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM user_roles
    WHERE id = '00000000-0000-0000-0000-000000000040'
      AND (
        user_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000002'
        OR organization_id IS DISTINCT FROM legacy_org
        OR role IS DISTINCT FROM 'admin'
        OR scope_type IS DISTINCT FROM 'global'
        OR custom_role_id IS NOT NULL
        OR scope_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy administrator role natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM user_roles
    WHERE id = '00000000-0000-0000-0000-000000000041'
      AND (
        user_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'
        OR organization_id IS DISTINCT FROM legacy_org
        OR role IS DISTINCT FROM 'requester'
        OR scope_type IS DISTINCT FROM 'global'
        OR custom_role_id IS NOT NULL
        OR scope_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy requester role natural key does not match';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM user_roles
    WHERE id = '00000000-0000-0000-0000-000000000042'
      AND (
        user_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000004'
        OR organization_id IS DISTINCT FROM legacy_org
        OR role IS DISTINCT FROM 'approver'
        OR scope_type IS DISTINCT FROM 'global'
        OR custom_role_id IS NOT NULL
        OR scope_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Refusing demo UUID migration: legacy approver role natural key does not match';
  END IF;

  CREATE TEMP TABLE _demo_uuid_map (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL UNIQUE
  ) ON COMMIT DROP;

  INSERT INTO _demo_uuid_map (old_id, new_id) VALUES (legacy_org, gen_random_uuid());
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000002', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-0000-0000-000000000002');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000003', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-0000-0000-000000000003');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000004', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM users WHERE id = '00000000-0000-0000-0000-000000000004');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000010', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM departments WHERE id = '00000000-0000-0000-0000-000000000010');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000011', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM departments WHERE id = '00000000-0000-0000-0000-000000000011');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000020', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM legal_entities WHERE id = '00000000-0000-0000-0000-000000000020');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000030', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM vendors WHERE id = '00000000-0000-0000-0000-000000000030');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000031', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM vendors WHERE id = '00000000-0000-0000-0000-000000000031');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000040', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM user_roles WHERE id = '00000000-0000-0000-0000-000000000040');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000041', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM user_roles WHERE id = '00000000-0000-0000-0000-000000000041');
  INSERT INTO _demo_uuid_map (old_id, new_id)
  SELECT '00000000-0000-0000-0000-000000000042', gen_random_uuid()
  WHERE EXISTS (SELECT 1 FROM user_roles WHERE id = '00000000-0000-0000-0000-000000000042');

  -- Clone the identity records with their new parents in place. Temporary
  -- uniqueness values make room for the old rows until all references move.
  INSERT INTO organizations (
    id, name, slug, base_currency, settings, logo_url, created_at, updated_at
  )
  SELECT map.new_id, source.name,
    left(source.slug || '--legacy-' || map.new_id::text, 100),
    source.base_currency, source.settings, source.logo_url,
    source.created_at, source.updated_at
  FROM organizations AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  WHERE source.id = legacy_org;

  INSERT INTO legal_entities (
    id, organization_id, name, code, currency, gl_account_prefix, address,
    tax_id, is_active, created_at, updated_at
  )
  SELECT map.new_id, organization_map.new_id, source.name, source.code,
    source.currency, source.gl_account_prefix, source.address, source.tax_id,
    source.is_active, source.created_at, source.updated_at
  FROM legal_entities AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  JOIN _demo_uuid_map AS organization_map ON organization_map.old_id = source.organization_id;

  INSERT INTO departments (
    id, organization_id, name, code, parent_id, budget_owner_id, created_at, updated_at
  )
  SELECT map.new_id, organization_map.new_id, source.name, source.code,
    COALESCE(parent_map.new_id, source.parent_id),
    COALESCE(owner_map.new_id, source.budget_owner_id),
    source.created_at, source.updated_at
  FROM departments AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  JOIN _demo_uuid_map AS organization_map ON organization_map.old_id = source.organization_id
  LEFT JOIN _demo_uuid_map AS parent_map ON parent_map.old_id = source.parent_id
  LEFT JOIN _demo_uuid_map AS owner_map ON owner_map.old_id = source.budget_owner_id;

  INSERT INTO users (
    id, organization_id, email, name, email_verified, image, department_id,
    manager_id, is_active, created_at, updated_at
  )
  SELECT map.new_id, organization_map.new_id,
    left(source.email || '+legacy-' || map.new_id::text, 255), source.name,
    source.email_verified, source.image,
    COALESCE(department_map.new_id, source.department_id),
    COALESCE(manager_map.new_id, source.manager_id), source.is_active,
    source.created_at, source.updated_at
  FROM users AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  JOIN _demo_uuid_map AS organization_map ON organization_map.old_id = source.organization_id
  LEFT JOIN _demo_uuid_map AS department_map ON department_map.old_id = source.department_id
  LEFT JOIN _demo_uuid_map AS manager_map ON manager_map.old_id = source.manager_id;

  INSERT INTO vendors (
    id, organization_id, entity_id, name, code, tax_id, payment_terms, address,
    contact_info, status, onboarding_status, onboarding_risk_score,
    onboarding_risk_level, onboarding_approved_at, onboarding_last_submitted_at,
    punchout_enabled, punchout_config, diversity_categories, esg_rating,
    carbon_footprint_tons, sustainability_certifications, esg_notes,
    diversity_verified_at, sanctions_status, sanctions_checked_at, sanctions_note,
    created_at, updated_at
  )
  SELECT map.new_id, organization_map.new_id,
    COALESCE(entity_map.new_id, source.entity_id), source.name, source.code,
    source.tax_id, source.payment_terms, source.address, source.contact_info,
    source.status, source.onboarding_status, source.onboarding_risk_score,
    source.onboarding_risk_level, source.onboarding_approved_at,
    source.onboarding_last_submitted_at, source.punchout_enabled,
    source.punchout_config, source.diversity_categories, source.esg_rating,
    source.carbon_footprint_tons, source.sustainability_certifications,
    source.esg_notes, source.diversity_verified_at, source.sanctions_status,
    source.sanctions_checked_at, source.sanctions_note, source.created_at,
    source.updated_at
  FROM vendors AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  JOIN _demo_uuid_map AS organization_map ON organization_map.old_id = source.organization_id
  LEFT JOIN _demo_uuid_map AS entity_map ON entity_map.old_id = source.entity_id;

  INSERT INTO user_roles (
    id, user_id, organization_id, role, custom_role_id, scope_type, scope_id, created_at
  )
  SELECT map.new_id, user_map.new_id, organization_map.new_id, source.role,
    COALESCE(custom_role_map.new_id, source.custom_role_id), source.scope_type,
    COALESCE(scope_map.new_id, source.scope_id), source.created_at
  FROM user_roles AS source
  JOIN _demo_uuid_map AS map ON map.old_id = source.id
  JOIN _demo_uuid_map AS user_map ON user_map.old_id = source.user_id
  JOIN _demo_uuid_map AS organization_map ON organization_map.old_id = source.organization_id
  LEFT JOIN _demo_uuid_map AS custom_role_map ON custom_role_map.old_id = source.custom_role_id
  LEFT JOIN _demo_uuid_map AS scope_map ON scope_map.old_id = source.scope_id;

  SELECT string_agg(
    format('WHEN %L::uuid THEN %L::uuid', old_id, new_id),
    ' ' ORDER BY old_id
  )
  INTO uuid_cases
  FROM _demo_uuid_map;

  SELECT new_id
  INTO migrated_org
  FROM _demo_uuid_map
  WHERE old_id = legacy_org;

  -- These organization-scoped graphs contain non-deferrable composite keys.
  -- Defer just their relationship checks while every side moves, then force
  -- validation and restore their original non-deferrable configuration below.
  ALTER TABLE email_intake_attachments
    ALTER CONSTRAINT email_intake_attachments_message_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT email_intake_attachments_item_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE sync_records
    ALTER CONSTRAINT sync_records_connection_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE budget_commitment_events
    ALTER CONSTRAINT budget_commitment_events_budget_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT budget_commitment_events_requisition_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT budget_commitment_events_purchase_order_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT budget_commitment_events_invoice_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE workflow_definitions
    ALTER CONSTRAINT workflow_definitions_published_version_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE workflow_definition_versions
    ALTER CONSTRAINT workflow_definition_versions_definition_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT workflow_definition_versions_published_by_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE approval_requests
    ALTER CONSTRAINT approval_requests_definition_version_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT approval_requests_initiated_by_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE workflow_approval_assignments
    ALTER CONSTRAINT workflow_approval_assignments_request_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT workflow_approval_assignments_resolved_approver_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT workflow_approval_assignments_assigned_approver_org_fk DEFERRABLE INITIALLY IMMEDIATE,
    ALTER CONSTRAINT workflow_approval_assignments_acted_by_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  ALTER TABLE workflow_runtime_publications
    ALTER CONSTRAINT workflow_runtime_publications_request_org_fk DEFERRABLE INITIALLY IMMEDIATE;
  SET CONSTRAINTS
    email_intake_attachments_message_org_fk,
    email_intake_attachments_item_org_fk,
    sync_records_connection_org_fk,
    budget_commitment_events_budget_org_fk,
    budget_commitment_events_requisition_org_fk,
    budget_commitment_events_purchase_order_org_fk,
    budget_commitment_events_invoice_org_fk,
    workflow_definitions_published_version_org_fk,
    workflow_definition_versions_definition_org_fk,
    workflow_definition_versions_published_by_org_fk,
    approval_requests_definition_version_org_fk,
    approval_requests_initiated_by_org_fk,
    workflow_approval_assignments_request_org_fk,
    workflow_approval_assignments_resolved_approver_org_fk,
    workflow_approval_assignments_assigned_approver_org_fk,
    workflow_approval_assignments_acted_by_org_fk,
    workflow_runtime_publications_request_org_fk
  DEFERRED;

  -- Move every declared FK that targets an identity table. Columns belonging
  -- to the same child table are set together so composite keys never observe
  -- a half-migrated organization/user or organization/vendor pair.
  FOR table_record IN
    SELECT
      fk_columns.table_schema,
      fk_columns.table_name,
      string_agg(
        format(
          '%I = CASE %I %s ELSE %I END',
          fk_columns.column_name,
          fk_columns.column_name,
          uuid_cases,
          fk_columns.column_name
        ),
        ', ' ORDER BY fk_columns.column_name
      ) AS uuid_set,
      string_agg(
        format('%I IN (SELECT old_id FROM _demo_uuid_map)', fk_columns.column_name),
        ' OR ' ORDER BY fk_columns.column_name
      ) AS uuid_where
    FROM (
      SELECT DISTINCT
        child_namespace.nspname AS table_schema,
        child_table.relname AS table_name,
        child_attribute.attname AS column_name
      FROM pg_constraint AS foreign_key
      JOIN pg_class AS child_table ON child_table.oid = foreign_key.conrelid
      JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_table.relnamespace
      JOIN pg_class AS parent_table ON parent_table.oid = foreign_key.confrelid
      JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_table.relnamespace
      CROSS JOIN LATERAL unnest(foreign_key.conkey) AS child_key(attnum)
      JOIN pg_attribute AS child_attribute
        ON child_attribute.attrelid = child_table.oid
        AND child_attribute.attnum = child_key.attnum
      WHERE foreign_key.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent_namespace.nspname = 'public'
        AND parent_table.relname = ANY(source_identity_tables)
        AND child_table.relname NOT IN (
          'approval_actions',
          'email_intake_messages',
          'workflow_definition_versions'
        )
    ) AS fk_columns
    GROUP BY fk_columns.table_schema, fk_columns.table_name
  LOOP
    uuid_where := table_record.uuid_where;
    IF table_record.table_name = ANY(source_identity_tables) THEN
      uuid_where := format('(%s) AND id NOT IN (SELECT old_id FROM _demo_uuid_map)', uuid_where);
    END IF;
    EXECUTE format(
      'UPDATE %I.%I SET %s WHERE %s',
      table_record.table_schema,
      table_record.table_name,
      table_record.uuid_set,
      uuid_where
    );
  END LOOP;

  -- Approval actions are append-only application evidence. This one-time
  -- identity repair changes only their actor foreign key so the historical
  -- record stays attached to the cloned user before legacy users are removed.
  EXECUTE format(
    $update$
      UPDATE approval_actions
      SET approver_id = CASE approver_id %s ELSE approver_id END
      WHERE approver_id IN (SELECT old_id FROM _demo_uuid_map)
    $update$,
    uuid_cases
  );

  -- These immutable tables deliberately stay out of the catalog sweep. Their
  -- named immutability triggers are disabled only for this guarded rewrite.
  ALTER TABLE email_intake_messages DISABLE TRIGGER email_intake_messages_append_only;
  EXECUTE format(
    $update$
      UPDATE email_intake_messages
      SET
        organization_id = CASE organization_id %s ELSE organization_id END,
        vendor_id = CASE vendor_id %s ELSE vendor_id END
      WHERE organization_id IN (SELECT old_id FROM _demo_uuid_map)
         OR vendor_id IN (SELECT old_id FROM _demo_uuid_map)
    $update$,
    uuid_cases,
    uuid_cases
  );

  ALTER TABLE workflow_definition_versions
    DISABLE TRIGGER workflow_definition_versions_immutable;
  EXECUTE format(
    $update$
      UPDATE workflow_definition_versions
      SET
        organization_id = CASE organization_id %s ELSE organization_id END,
        published_by = CASE published_by %s ELSE published_by END
      WHERE organization_id IN (SELECT old_id FROM _demo_uuid_map)
         OR published_by IN (SELECT old_id FROM _demo_uuid_map)
    $update$,
    uuid_cases,
    uuid_cases
  );

  -- Only workflow resolver userId fields may contain nested fixture identities.
  -- The version trigger remains disabled until this guarded rewrite is complete.
  FOR map_record IN
    SELECT old_id, new_id
    FROM _demo_uuid_map
    WHERE old_id IN (
      '00000000-0000-0000-0000-000000000002'::uuid,
      '00000000-0000-0000-0000-000000000003'::uuid,
      '00000000-0000-0000-0000-000000000004'::uuid
    )
  LOOP
    UPDATE workflow_definitions
    SET current_draft = pg_temp.remap_workflow_resolver_user_id(
      current_draft,
      map_record.old_id::text,
      map_record.new_id::text
    )
    WHERE organization_id = migrated_org
      AND current_draft IS DISTINCT FROM pg_temp.remap_workflow_resolver_user_id(
        current_draft,
        map_record.old_id::text,
        map_record.new_id::text
      );

    UPDATE workflow_definition_versions
    SET
      graph_json = pg_temp.remap_workflow_resolver_user_id(
        graph_json,
        map_record.old_id::text,
        map_record.new_id::text
      ),
      executable_json = pg_temp.remap_workflow_resolver_user_id(
        executable_json,
        map_record.old_id::text,
        map_record.new_id::text
      )
    WHERE organization_id = migrated_org
      AND (
        graph_json IS DISTINCT FROM pg_temp.remap_workflow_resolver_user_id(
          graph_json,
          map_record.old_id::text,
          map_record.new_id::text
        )
        OR executable_json IS DISTINCT FROM pg_temp.remap_workflow_resolver_user_id(
          executable_json,
          map_record.old_id::text,
          map_record.new_id::text
        )
      );
  END LOOP;

  SET CONSTRAINTS
    email_intake_attachments_message_org_fk,
    email_intake_attachments_item_org_fk,
    sync_records_connection_org_fk,
    budget_commitment_events_budget_org_fk,
    budget_commitment_events_requisition_org_fk,
    budget_commitment_events_purchase_order_org_fk,
    budget_commitment_events_invoice_org_fk,
    workflow_definitions_published_version_org_fk,
    workflow_definition_versions_definition_org_fk,
    workflow_definition_versions_published_by_org_fk,
    approval_requests_definition_version_org_fk,
    approval_requests_initiated_by_org_fk,
    workflow_approval_assignments_request_org_fk,
    workflow_approval_assignments_resolved_approver_org_fk,
    workflow_approval_assignments_assigned_approver_org_fk,
    workflow_approval_assignments_acted_by_org_fk,
    workflow_runtime_publications_request_org_fk
  IMMEDIATE;
  ALTER TABLE email_intake_messages ENABLE TRIGGER email_intake_messages_append_only;
  ALTER TABLE workflow_definition_versions
    ENABLE TRIGGER workflow_definition_versions_immutable;
  ALTER TABLE email_intake_attachments
    ALTER CONSTRAINT email_intake_attachments_message_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT email_intake_attachments_item_org_fk NOT DEFERRABLE;
  ALTER TABLE sync_records
    ALTER CONSTRAINT sync_records_connection_org_fk NOT DEFERRABLE;
  ALTER TABLE budget_commitment_events
    ALTER CONSTRAINT budget_commitment_events_budget_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT budget_commitment_events_requisition_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT budget_commitment_events_purchase_order_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT budget_commitment_events_invoice_org_fk NOT DEFERRABLE;
  ALTER TABLE workflow_definitions
    ALTER CONSTRAINT workflow_definitions_published_version_org_fk NOT DEFERRABLE;
  ALTER TABLE workflow_definition_versions
    ALTER CONSTRAINT workflow_definition_versions_definition_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT workflow_definition_versions_published_by_org_fk NOT DEFERRABLE;
  ALTER TABLE approval_requests
    ALTER CONSTRAINT approval_requests_definition_version_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT approval_requests_initiated_by_org_fk NOT DEFERRABLE;
  ALTER TABLE workflow_approval_assignments
    ALTER CONSTRAINT workflow_approval_assignments_request_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT workflow_approval_assignments_resolved_approver_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT workflow_approval_assignments_assigned_approver_org_fk NOT DEFERRABLE,
    ALTER CONSTRAINT workflow_approval_assignments_acted_by_org_fk NOT DEFERRABLE;
  ALTER TABLE workflow_runtime_publications
    ALTER CONSTRAINT workflow_runtime_publications_request_org_fk NOT DEFERRABLE;

  -- A few older tables intentionally use polymorphic or audit references
  -- instead of foreign keys. This is the complete, audited list of those
  -- scalar identity columns. Keep it explicit: arbitrary UUID columns are not
  -- part of this migration.
  FOR column_record IN
    SELECT reference_columns.table_name, reference_columns.column_name
    FROM (
      VALUES
        ('approval_delegations', 'organization_id'),
        ('approval_requests', 'approvable_id'),
        ('approval_rule_steps', 'approver_id'),
        ('audit_log', 'organization_id'),
        ('audit_log', 'user_id'),
        ('audit_log', 'entity_id'),
        ('budget_commitment_events', 'organization_id'),
        ('budgets', 'scope_id'),
        ('departments', 'parent_id'),
        ('departments', 'budget_owner_id'),
        ('documents', 'organization_id'),
        ('documents', 'uploaded_by'),
        ('documents', 'entity_id'),
        ('inventory_movements', 'organization_id'),
        ('inventory_movements', 'reference_id'),
        ('notification_preferences', 'organization_id'),
        ('notifications', 'organization_id'),
        ('notifications', 'entity_id'),
        ('ocr_jobs', 'uploaded_by'),
        ('sequences', 'organization_id'),
        ('spend_guard_alerts', 'record_id'),
        ('spend_guard_alerts', 'resolved_by'),
        ('system_settings', 'organization_id'),
        ('user_roles', 'scope_id')
    ) AS reference_columns(table_name, column_name)
  LOOP
    uuid_where := format('%I IN (SELECT old_id FROM _demo_uuid_map)', column_record.column_name);
    IF column_record.table_name = ANY(source_identity_tables) THEN
      uuid_where := format('(%s) AND id NOT IN (SELECT old_id FROM _demo_uuid_map)', uuid_where);
    END IF;
    EXECUTE format(
      'UPDATE public.%I
       SET %I = CASE %I %s ELSE %I END
       WHERE %s',
      column_record.table_name,
      column_record.column_name,
      column_record.column_name,
      uuid_cases,
      column_record.column_name,
      uuid_where
    );
  END LOOP;

  -- Only known identifier-bearing JSON fields are rewritten, and only after
  -- their audit or template row has moved into the migrated demo organization.
  -- User-authored JSON and all free-form text stay untouched.
  FOR map_record IN SELECT old_id, new_id FROM _demo_uuid_map LOOP
    UPDATE audit_log
    SET changes = jsonb_set(
      changes,
      '{requesterId}',
      to_jsonb(map_record.new_id::text),
      false
    )
    WHERE organization_id = migrated_org
      AND changes ->> 'requesterId' = map_record.old_id::text;

    UPDATE audit_log
    SET metadata = jsonb_set(
      metadata,
      '{ownerId}',
      to_jsonb(map_record.new_id::text),
      false
    )
    WHERE organization_id = migrated_org
      AND metadata ->> 'ownerId' = map_record.old_id::text;

    UPDATE requisition_templates
    SET template_data = jsonb_set(
      template_data,
      '{departmentId}',
      to_jsonb(map_record.new_id::text),
      false
    )
    WHERE organization_id = migrated_org
      AND template_data ->> 'departmentId' = map_record.old_id::text;
  END LOOP;

  -- All references now point at the cloned identities. Delete only the
  -- recognized legacy rows, preserving every workload row and its payload.
  DELETE FROM user_roles
  WHERE id IN (
    '00000000-0000-0000-0000-000000000040',
    '00000000-0000-0000-0000-000000000041',
    '00000000-0000-0000-0000-000000000042'
  );
  DELETE FROM vendors
  WHERE id IN (
    '00000000-0000-0000-0000-000000000030',
    '00000000-0000-0000-0000-000000000031'
  );
  DELETE FROM users
  WHERE id IN (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004'
  );
  DELETE FROM departments
  WHERE id IN (
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000011'
  );
  DELETE FROM legal_entities
  WHERE id = '00000000-0000-0000-0000-000000000020';
  DELETE FROM organizations WHERE id = legacy_org;

  -- Restore the canonical natural keys after the temporary uniqueness values
  -- have been freed by deleting the old source rows.
  UPDATE organizations
  SET name = 'Acme Corp', slug = 'acme-corp'
  WHERE id = (SELECT new_id FROM _demo_uuid_map WHERE old_id = legacy_org);
  UPDATE users
  SET email = 'admin@acme.com'
  WHERE id = (SELECT new_id FROM _demo_uuid_map WHERE old_id = '00000000-0000-0000-0000-000000000002');
  UPDATE users
  SET email = 'requester@acme.com'
  WHERE id = (SELECT new_id FROM _demo_uuid_map WHERE old_id = '00000000-0000-0000-0000-000000000003');
  UPDATE users
  SET email = 'approver@acme.com'
  WHERE id = (SELECT new_id FROM _demo_uuid_map WHERE old_id = '00000000-0000-0000-0000-000000000004');
END;
$migration$;
