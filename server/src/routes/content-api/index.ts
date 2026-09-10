/**
 * No public routes. Collaboration happens over the WebSocket at `/collab`,
 * which authenticates each connection with an admin token of its own.
 */
export default () => ({
  type: 'content-api',
  routes: [],
});
