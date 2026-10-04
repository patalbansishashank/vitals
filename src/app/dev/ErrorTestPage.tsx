/**
 * /dev/error — throws while rendering so the route error boundary (RouteError) can be checked by hand and in tests.
 * Developer surface: never linked from navigation.
 */
export default function ErrorTestPage(): never {
  throw new Error('Deliberate test error from /dev/error');
}
