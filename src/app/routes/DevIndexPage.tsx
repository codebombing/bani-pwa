import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { Item } from '@astryxdesign/core/Item';
import { List } from '@astryxdesign/core/List';
import { Spinner } from '@astryxdesign/core/Spinner';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../shared/supabase';

const tenantRowSchema = z.object({
  slug: z.string(),
  name: z.string(),
  status: z.enum(['preview', 'live', 'archived']),
});

async function fetchTenants() {
  const { data, error } = await getSupabase()
    .from('public_tenants')
    .select('slug, name, status')
    .order('slug');
  if (error) throw new Error(error.message);
  return z.array(tenantRowSchema).parse(data);
}

/** Служебная страница: ссылки на опубликованные заведения. В production не показывает список. */
export function DevIndexPage() {
  if (!import.meta.env.DEV) {
    return (
      <VStack padding={6} gap={4}>
        <EmptyState
          title="Откройте ссылку заведения"
          description="Адрес вида /s/название-заведения/ вам пришлёт заведение."
        />
      </VStack>
    );
  }
  return <DevTenantList />;
}

function DevTenantList() {
  const tenants = useQuery({ queryKey: ['dev', 'tenants'], queryFn: fetchTenants });

  return (
    <VStack padding={6} gap={4} maxWidth={640}>
      <Heading level={1}>Заведения (dev)</Heading>
      <Text color="secondary">Служебная страница локальной разработки.</Text>
      {tenants.isPending && <Spinner size="lg" label="Загружаем заведения" />}
      {tenants.isError && (
        <Banner
          status="error"
          title="Не удалось загрузить заведения"
          description={tenants.error.message}
          endContent={<Button label="Повторить" onClick={() => void tenants.refetch()} />}
        />
      )}
      {tenants.isSuccess && tenants.data.length === 0 && (
        <EmptyState
          title="Заведений пока нет"
          description="Опубликуйте заведение: npm run tenant:publish -- <slug>"
        />
      )}
      {tenants.isSuccess && tenants.data.length > 0 && (
        <List hasDividers>
          {tenants.data.map((t) => (
            <Item
              key={t.slug}
              label={t.name}
              description={`/s/${t.slug}/ · ${t.status}`}
              href={`/s/${t.slug}/`}
              endContent={
                <Button variant="ghost" size="sm" label="Кабинет" href={`/s/${t.slug}/owner/`} />
              }
            />
          ))}
        </List>
      )}
    </VStack>
  );
}
