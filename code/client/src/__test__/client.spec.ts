/**
 * @file This file contains tests for file `../client.ts`.
 */

import test, { type ExecutionContext } from "ava";
import getPort from "@ava/get-port";
import * as dataFE from "@ty-ras/data-frontend";
import * as http from "node:http";
import * as http2 from "node:http2";
import type * as stream from "node:stream";
import type * as net from "node:net";

import * as spec from "../client";

test("Verify that raw string variant works", async (c) => {
  c.plan(2);
  const host = "localhost";
  const port = await getPort();
  const callback = spec.createCallHTTPEndpoint(`http://${host}:${port}`);
  const capturedInfo = await createTrackingServerAndListen(host, port, [
    undefined,
  ]);

  const method = "GET";
  const url = "/hello";
  const result = await callback({ method, url });
  c.deepEqual(capturedInfo, [
    {
      method,
      url,
      body: undefined,
      headers: getExpectedServerIncomingHeaders({
        host,
        port,
        scheme: "http",
        method,
        path: url,
      }),
    },
  ]);
  c.deepEqual(result, {
    body: undefined,
    headers: getExpectedClientIncomingHeaders(1),
  });
});

test("Test that config-based callback works with simple usecase", async (c) => {
  c.plan(2);
  const { callback, capturedInfo, ...settings } = await prepareForTest();

  const method = "GET";
  const url = "/hello";
  const result = await callback({ method, url });
  c.deepEqual(capturedInfo, [
    {
      method,
      url,
      body: undefined,
      headers: getExpectedServerIncomingHeaders({
        ...settings,
        method,
        path: url,
        scheme: "http",
      }),
    },
  ]);
  c.deepEqual(result, {
    body: undefined,
    headers: getExpectedClientIncomingHeaders(),
  });
});

test("Test that config-based callback works with complex usecase", async (c) => {
  c.plan(2);
  const responseBody = { theResponseBody: "that" };
  const { callback, capturedInfo, ...settings } = await prepareForTest([
    JSON.stringify(responseBody),
  ]);

  const method = "POST";
  const url = "/hello";
  const query = {
    x: "1",
    y: 2,
  };
  const body = {
    theBody: "this is \u00e4",
  };
  const headers = {
    someCustomHeader: "someRandomValue",
    theArrayHeader: ["one", "two"],
  };
  const result = await callback({ method, url, query, body, headers });
  const path = `${url}?${Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&")}`;
  const bodyAsString = JSON.stringify(body);
  c.deepEqual(capturedInfo, [
    {
      method,
      url: path,
      body: bodyAsString,
      headers: getExpectedServerIncomingHeaders(
        {
          ...settings,
          method,
          path,
          scheme: "http",
        },
        {
          additionalHeaders: {
            ...headers,
            theArrayHeader: headers.theArrayHeader.join(", "),
          },
          body: bodyAsString,
        },
      ),
    },
  ]);
  c.deepEqual(result, {
    body: responseBody,
    headers: getExpectedClientIncomingHeaders(200),
  });
});

test("Test that non-2xx status code in is handled correctly", async (c) => {
  c.plan(1);

  const statusCode = 404;
  const { callback } = await prepareForTest([statusCode]);

  await c.throwsAsync(
    async () => await callback({ method: "GET", url: "/hello" }),
    {
      instanceOf: dataFE.Non2xxStatusCodeError,
      message: `Status code ${statusCode} was returned.`,
    },
  );
});

test("Test that using tricky path names will be handled correctly", async (c: ExecutionContext) => {
  c.plan(2);
  const { callback, capturedInfo, ...settings } = await prepareForTest();

  const method = "GET";
  const result = await callback({
    method,
    url: "/hello/?injected-query-#-and-fragment/",
  });
  const url = "/hello/%3Finjected-query-%23-and-fragment/";
  c.deepEqual(capturedInfo, [
    {
      method,
      url,
      body: undefined,
      headers: getExpectedServerIncomingHeaders({
        ...settings,
        method,
        path: url,
        scheme: "http",
      }),
    },
  ]);
  c.deepEqual(result, {
    body: undefined,
    headers: getExpectedClientIncomingHeaders(),
  });
});

test("Validate that URL sanity check works", async (c) => {
  c.plan(4);
  const { callback, capturedInfo, ...settings } = await prepareForTest();

  const verifyURLSanity = async (clientURL: string, serverURL: string) => {
    capturedInfo.length = 0;
    const method = "GET";
    const result = await callback({
      method,
      url: clientURL,
    });
    c.deepEqual(capturedInfo, [
      {
        method,
        url: serverURL,
        body: undefined,
        headers: getExpectedServerIncomingHeaders({
          ...settings,
          method,
          path: serverURL,
          scheme: "http",
        }),
      },
    ]);
    c.deepEqual(result, {
      body: undefined,
      headers: getExpectedClientIncomingHeaders(),
    });
  };

  await verifyURLSanity("ftp://__dummy__", `/ftp://__dummy__`);
  await verifyURLSanity("http://example.com", "/http://example.com");
});

const prepareForTest = async (
  responses: PreparedServerRespones = [undefined],
) => {
  const host = "localhost";
  const port = await getPort();

  const capturedInfo = await createTrackingServerAndListen(
    host,
    port,
    responses,
  );
  return {
    host,
    port,
    capturedInfo,
    callback: createCallback(host, port),
  };
};

const createCallback = (host: string, port: number) => {
  return spec.createCallHTTPEndpoint({
    config: {
      baseURL: `http://${host}:${port}`,
    },
  });
};

const listenAsync = (server: net.Server, host: string, port: number) =>
  new Promise<void>((resolve, reject) => {
    try {
      server.addListener("error", reject);
      server.listen({ host, port }, () => {
        server.removeListener("error", reject);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });

const createTrackingServerAndListen = async (
  host: string,
  port: number,
  responses: PreparedServerRespones,
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const capturedInfo: Array<{
    method: string | undefined;
    url: string | undefined;
    headers: Record<string, unknown>;
    body: string | undefined;
  }> = [];
  let idx = 0;
  const handleResponse = (
    req: http.IncomingMessage | http2.Http2ServerRequest,
    res: http.ServerResponse | http2.Http2ServerResponse,
  ) => {
    let body: string | undefined;
    req.on("data", (chunk: string | Uint8Array) => {
      if (chunk instanceof Uint8Array) {
        chunk = Buffer.from(chunk).toString("utf8");
      }
      if (body === undefined) {
        body = chunk;
      } else {
        body += chunk;
      }
    });
    req.on("end", () => {
      capturedInfo.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      const responseInfo = responses[idx++];
      res.sendDate = false; // Makes life easier
      let callEnd = true;
      if (responseInfo === undefined) {
        res.statusCode = 204;
      } else if (typeof responseInfo === "string") {
        res.statusCode = 200;
        (res as stream.Writable).write(responseInfo);
      } else if (typeof responseInfo === "number") {
        res.statusCode = responseInfo;
      } else {
        responseInfo(req, res);
        callEnd = false;
      }

      if (callEnd) {
        res.end();
      }
    });
  };
  const server = http.createServer(handleResponse);
  await listenAsync(server, host, port);
  return capturedInfo;
};

const getExpectedServerIncomingHeaders = (
  {
    host,
    port,
  }: Pick<Awaited<ReturnType<typeof prepareForTest>>, "host" | "port"> & {
    path: string;
    method: string;
    scheme: string;
  },
  {
    additionalHeaders,
    body,
  }: {
    additionalHeaders: Record<string, unknown>;
    body: string | undefined;
  } = {
    additionalHeaders: {},
    body: undefined,
  },
): Record<string, unknown> => ({
  ...Object.fromEntries(
    Object.entries(additionalHeaders).map(
      ([k, v]) => [k.toLowerCase(), v] as const,
    ),
  ),
  connection: "close",
  host: `${host}:${port}`,
  "user-agent": "axios/1.5.0",
  accept: "application/json, text/plain, */*",
  "accept-encoding": "gzip, compress, deflate, br",
  ...(body === undefined
    ? {}
    : {
        "content-length": `${Buffer.from(body, "utf8").byteLength}`,
        "content-type": "application/json; charset=utf-8",
      }),
});

const getExpectedClientIncomingHeaders = (
  statusCode: number = 204,
): Record<string, unknown> => ({
  connection: "close",
  ...(statusCode === 200 ? { "transfer-encoding": "chunked" } : {}),
});

type PreparedServerRespones = ReadonlyArray<
  | string
  | undefined
  | number
  | ((
      req: http.IncomingMessage | http2.Http2ServerRequest,
      res: http.ServerResponse | http2.Http2ServerResponse,
    ) => void)
>;
