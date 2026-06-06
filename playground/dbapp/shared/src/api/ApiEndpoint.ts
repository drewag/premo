import { z } from "zod";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiEndpoint<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny> {
  readonly method: ApiMethod;
  readonly path: string;
  readonly requestType: TReq;
  readonly responseType: TRes;

  private constructor(method: ApiMethod, p: string, req: TReq, res: TRes) {
    this.method = method;
    this.path = p;
    this.requestType = req;
    this.responseType = res;
  }

  static create<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(opts: {
    method: ApiMethod;
    path: string;
    requestType: TReq;
    responseType: TRes;
  }): ApiEndpoint<TReq, TRes> {
    return new ApiEndpoint(opts.method, opts.path, opts.requestType, opts.responseType);
  }
}

export type InferRequest<E> = E extends ApiEndpoint<infer R, z.ZodTypeAny> ? z.infer<R> : never;
export type InferResponse<E> = E extends ApiEndpoint<z.ZodTypeAny, infer R> ? z.infer<R> : never;
