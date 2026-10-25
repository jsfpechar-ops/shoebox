import { redirect } from 'next/navigation';

/** `/` (M11 §3). TODO(P0-AUTH-01): owner/member → /prehled when they have documents, accountant → /ucetni. */
export default function Home(): never {
  redirect('/inbox');
}
