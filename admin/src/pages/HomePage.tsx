import { useEffect, useState } from "react";
import {
  Badge,
  Box,
  Flex,
  Loader,
  Main,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from "@strapi/design-system";
import { getFetchClient } from "@strapi/strapi/admin";

import { parseDocumentName, type CollabConfig } from "../../../shared/collab";
import { PLUGIN_ID } from "../pluginId";

interface Status {
  config: CollabConfig;
  sessions: Array<{ documentName: string; clients: number }>;
}

/**
 * Operations view: which fields are being edited right now, and by how many people.
 *
 * Polled rather than pushed — this page is glanced at occasionally, and giving it its own
 * WebSocket would cost a connection per open admin tab for information that is never urgent.
 */
const HomePage = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const { data } = await getFetchClient().get<{ data: Status }>(`/${PLUGIN_ID}/status`);
        if (active) {
          setStatus(data.data);
          setError(null);
        }
      } catch (loadError) {
        if (active) setError((loadError as Error).message);
      }
    };

    void load();
    const timer = setInterval(load, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Main>
      <Box padding={8}>
        <Flex direction="column" alignItems="flex-start" gap={1} marginBottom={6}>
          <Typography variant="alpha" tag="h1">
            Collab
          </Typography>
          <Typography variant="epsilon" textColor="neutral600">
            Live collaborative editing sessions. Add the{" "}
            <strong>Collaborative text</strong> custom field to any content-type to open one.
          </Typography>
        </Flex>

        {error ? (
          <Box paddingBottom={4}>
            <Typography textColor="danger600">{error}</Typography>
          </Box>
        ) : null}

        {status === null ? (
          <Loader>Loading sessions</Loader>
        ) : (
          <>
            <Box background="neutral0" padding={5} hasRadius shadow="tableShadow" marginBottom={6}>
              <Typography variant="sigma" textColor="neutral600">
                Configuration
              </Typography>
              <Flex gap={4} paddingTop={3} wrap="wrap">
                <Typography variant="pi">
                  Commit after <strong>{status.config.debounceSeconds}s</strong> of quiet
                </Typography>
                <Typography variant="pi">
                  Redis:{" "}
                  <strong>{status.config.redis ? "configured" : "not configured"}</strong>
                </Typography>
                <Typography variant="pi">
                  Enabled on:{" "}
                  <strong>
                    {status.config.contentTypes.length === 0
                      ? "every content-type"
                      : status.config.contentTypes.join(", ")}
                  </strong>
                </Typography>
              </Flex>
            </Box>

            <Box background="neutral0" padding={5} hasRadius shadow="tableShadow">
              <Typography variant="delta" tag="h2">
                Live sessions ({status.sessions.length})
              </Typography>

              <Box paddingTop={3}>
                {status.sessions.length === 0 ? (
                  <Typography textColor="neutral600">
                    Nobody is editing collaboratively right now.
                  </Typography>
                ) : (
                  <Table colCount={4} rowCount={status.sessions.length + 1}>
                    <Thead>
                      <Tr>
                        {["Content-type", "Entry", "Field", "Editors"].map((label) => (
                          <Th key={label}>
                            <Typography variant="sigma">{label}</Typography>
                          </Th>
                        ))}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {status.sessions.map((session) => {
                        const parsed = parseDocumentName(session.documentName);

                        return (
                          <Tr key={session.documentName}>
                            <Td>
                              <Typography textColor="neutral600">
                                {parsed?.uid ?? session.documentName}
                              </Typography>
                            </Td>
                            <Td>
                              <Typography variant="pi" textColor="neutral500">
                                {parsed?.documentId ?? "—"}
                              </Typography>
                            </Td>
                            <Td>
                              <Typography fontWeight="bold">{parsed?.field ?? "—"}</Typography>
                            </Td>
                            <Td>
                              <Badge>{session.clients}</Badge>
                            </Td>
                          </Tr>
                        );
                      })}
                    </Tbody>
                  </Table>
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Main>
  );
};

export { HomePage };
