export default async (req, res) => {
  const { reqHandler } = await import('../dist/safezone-ui/server/server.mjs');
  return reqHandler(req, res);
};
