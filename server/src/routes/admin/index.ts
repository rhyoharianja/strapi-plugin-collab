export default () => ({
  type: 'admin',
  routes: [
    { method: 'GET', path: '/status', handler: 'session.status', config: { policies: [] } },
  ],
});
