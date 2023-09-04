/**
 * @file This file contains function to create {@link dataFE.CallHTTPEndpoint} which will use Axios library to do the requests.
 */

import * as data from "@ty-ras/data";
import type * as dataFE from "@ty-ras/data-frontend";
import axios, {
  type CreateAxiosDefaults,
  type AxiosInstance,
  AxiosHeaders,
} from "axios";
import * as errors from "./errors";

/**
 * This function will create a {@link dataFE.CallHTTPEndpoint} callback using new or given Axios instance.
 *
 * Notice that unless Axios instance is explicitly specified via {@link HTTPEndpointCallerOptionsInstance.instance}, a new Axios instance will be created.
 * @param argsOrURL The {@link HTTPEndpointCallerArgs}: either base URL string (HTTP1 protocol will be used then), or structured information about the HTTP protocol version and associated settings.
 * @returns A {@link dataFE.CallHTTPEndpoint} callback which can be used to create instances of {@link dataFE.APICallFactoryBase}.
 * It will also throw whatever the {@link URL} constructor might throw, if passed invalid URL as `string` value.
 * @see HTTPEndpointCallerArgs
 */
export const createCallHTTPEndpoint = (
  argsOrURL: HTTPEndpointCallerArgs,
): dataFE.CallHTTPEndpoint => {
  const args: HTTPEndpointCallerOptions =
    typeof argsOrURL === "string"
      ? { config: { baseURL: argsOrURL } }
      : argsOrURL;
  const instance: AxiosInstance =
    "config" in args ? axios.create(args.config) : args.instance;
  const reviver = data.getJSONParseReviver(args.allowProtoProperty === true);

  return async ({
    method,
    url,
    query,
    body: requestBody,
    headers: requestHeaders,
  }) => {
    const urlObject = new URL(url, DUMMY_ORIGIN);
    if (urlObject.origin !== DUMMY_ORIGIN || urlObject.href === url) {
      // We were passed an absolute URL -> "escape" it by prepending forward slash so that Axios will always use baseURL
      url = `/${url}`;
    }
    const {
      status,
      headers,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: body,
    } = await instance({
      method,
      url: ensureNoQueryOrFragment(url),
      ...(requestHeaders === undefined
        ? {}
        : {
            headers: new AxiosHeaders(getOutgoingHeaders(requestHeaders)),
          }),
      ...(query === undefined ? {} : { params: getURLSearchParams(query) }),
      ...(requestBody === undefined
        ? {}
        : { data: JSON.stringify(requestBody) }),
      responseType: "text",
    });

    if (status < 200 || status >= 300) {
      throw new errors.Non2xxStatusCodeError(status);
    }

    return {
      headers: Object.fromEntries(
        Object.entries(headers).filter(
          ([, header]) => header !== undefined && header !== null,
        ),
      ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      body: JSON.parse(body, reviver),
    };
  };
};

/**
 * This type is the argument of {@link createCallHTTPEndpoint}.
 * It can be either string, which is then interpreted as full URL.
 * Alternatively, it can be a structured object {@link HTTPEndpointCallerOptions}.
 * @see HTTPEndpointCallerOptions
 */
export type HTTPEndpointCallerArgs = HTTPEndpointCallerOptions | string;

/**
 * These options used to create callback thru {@link createCallHTTPEndpoint} should be either {@link HTTPEndpointCallerOptionsConfig} for specifying Axios instance creation parameters, or {@link HTTPEndpointCallerOptionsInstance} to directly provide instance to Axios.
 */
export type HTTPEndpointCallerOptions =
  | HTTPEndpointCallerOptionsConfig
  | HTTPEndpointCallerOptionsInstance;

/**
 * This interface contains properties used in {@link createCallHTTPEndpoint} when configuration for new Axios instance is provided.
 */
export interface HTTPEndpointCallerOptionsConfig
  extends HTTPEndpointCallerOptionsBase {
  /**
   * The configuration for new Axios instance to use. Must contain at least {@link CreateAxiosDefaults.baseURL} property.
   */
  config: Omit<
    CreateAxiosDefaults,
    | "url"
    | "method"
    | "params"
    | "paramsSerializer"
    | "data"
    | "auth"
    | "baseURL"
  > &
    Required<Pick<CreateAxiosDefaults, "baseURL">>;
}

/**
 * This interface contains properties used in {@link createCallHTTPEndpoint} when the Axios instance itself is provided.
 */
export interface HTTPEndpointCallerOptionsInstance
  extends HTTPEndpointCallerOptionsBase {
  /**
   * The Axios instance to use.
   */
  instance: AxiosInstance;
}

/**
 * This interface contains properties common for both {@link HTTPEndpointCallerOptionsConfig} and {@link HTTPEndpointCallerOptionsInstance}.
 */
export interface HTTPEndpointCallerOptionsBase {
  /**
   * If set to `true`, will NOT strip the `__proto__` properties of the result.
   */
  allowProtoProperty?: boolean;
}

const DUMMY_ORIGIN = "ftp://__dummy__";

const getURLSearchParams = (query: Record<string, unknown>) =>
  new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .flatMap<[string, string]>(([qKey, qValue]) =>
        Array.isArray(qValue)
          ? qValue.map<[string, string]>((value) => [qKey, `${value}`])
          : [[qKey, `${qValue}`]],
      ),
  );

const ensureNoQueryOrFragment = (path: string) =>
  path.replaceAll(
    /\?|#/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const getOutgoingHeaders = (headers: Record<string, unknown> | undefined) =>
  headers === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(headers)
          .filter(([, header]) => header !== undefined)
          .map(
            ([headerName, header]) =>
              [headerName, getOutgoingHeader(header)] as const,
          ),
      );

const getOutgoingHeader = (header: unknown): string | number | Array<string> =>
  typeof header === "string" || typeof header === "number"
    ? header
    : Array.isArray(header)
    ? header.filter((v) => v !== undefined).map((v) => `${v}`)
    : `${header}`;
