/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */


export interface paths {
  "/api/v1/documents/": {
    get: operations["listDocuments"];
    post: operations["createDocument"];
  };
  "/api/v1/documents/{id}/": {
    get: operations["retrieveDocument"];
    put: operations["updateDocument"];
    delete: operations["destroyDocument"];
    patch: operations["partialUpdateDocument"];
  };
  "/api/v1/users/me/": {
    get: operations["meUserCreate"];
  };
  "/api/v1/tasks/": {
    get: operations["listTasks"];
    post: operations["createTask"];
  };
  "/api/v1/tasks/{id}/": {
    get: operations["retrieveTask"];
  };
  "/api/v1/users/": {
    post: operations["createUserCreate"];
  };
  "/api/v1/users/login/": {
    post: operations["loginUserCreate"];
  };
  "/api/v1/tasks/claim_unassigned_task/": {
    post: operations["claimUnassignedTaskTask"];
  };
  "/api/v1/tasks/{id}/keepalive/": {
    post: operations["keepaliveKeepalive"];
  };
  "/api/v1/tasks/{id}/mark_completed/": {
    post: operations["markCompletedTaskComplete"];
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    Document: {
      /** Format: uuid */
      id?: string;
      name: string;
      /** Format: binary */
      audio_file: string;
      /** Format: date-time */
      created_at?: string;
      /** Format: date-time */
      changed_at?: string;
    };
    UserCreate: {
      username: string;
      password: string;
    };
    UnauthenticatedError: {
      detail: string;
    };
    ForbiddenError: {
      detail: string;
    };
    Task: {
      /** Format: uuid */
      id?: string;
      document: string;
      /** @enum {string} */
      task_type: "DIARIZE" | "TRANSCRIBE" | "ALIGN";
      progress?: number | null;
      /** @description Task parameters like language, number of speakers, ... */
      task_parameters?: Record<string, never>;
      assigned_worker?: string | null;
      /** Format: date-time */
      last_keepalive?: string;
      /** Format: date-time */
      assigned_at?: string | null;
      /** Format: date-time */
      completed_at?: string | null;
      completion_data?: Record<string, never>;
    };
    ValidationError: {
      errors: Record<string, never>;
      non_field_errors: (string)[];
    };
    NotFoundError: {
      detail: string;
    };
    Token: {
      token: string;
    };
    Keepalive: {
      progress?: number;
    };
    TaskComplete: {
      completion_data: Record<string, never>;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type external = Record<string, never>;

export interface operations {

  listDocuments: {
    responses: {
      200: {
        content: {
          "application/json": (components["schemas"]["Document"])[];
        };
      };
    };
  };
  createDocument: {
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Document"];
        "application/x-www-form-urlencoded": components["schemas"]["Document"];
        "multipart/form-data": components["schemas"]["Document"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
    };
  };
  retrieveDocument: {
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
    };
  };
  updateDocument: {
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Document"];
        "application/x-www-form-urlencoded": components["schemas"]["Document"];
        "multipart/form-data": components["schemas"]["Document"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
    };
  };
  destroyDocument: {
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      204: never;
    };
  };
  partialUpdateDocument: {
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Document"];
        "application/x-www-form-urlencoded": components["schemas"]["Document"];
        "multipart/form-data": components["schemas"]["Document"];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
    };
  };
  meUserCreate: {
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["UserCreate"];
        };
      };
      401: {
        content: {
          "application/json": components["schemas"]["UnauthenticatedError"];
        };
      };
      403: {
        content: {
          "application/json": components["schemas"]["ForbiddenError"];
        };
      };
    };
  };
  listTasks: {
    responses: {
      200: {
        content: {
          "application/json": (components["schemas"]["Task"])[];
        };
      };
    };
  };
  createTask: {
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Task"];
        "application/x-www-form-urlencoded": components["schemas"]["Task"];
        "multipart/form-data": components["schemas"]["Task"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Task"];
        };
      };
    };
  };
  retrieveTask: {
    parameters: {
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": components["schemas"]["Task"];
        };
      };
    };
  };
  createUserCreate: {
    requestBody?: {
      content: {
        "application/json": components["schemas"]["UserCreate"];
        "application/x-www-form-urlencoded": components["schemas"]["UserCreate"];
        "multipart/form-data": components["schemas"]["UserCreate"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["UserCreate"];
        };
      };
      400: {
        content: {
          "application/json": components["schemas"]["ValidationError"];
        };
      };
      401: {
        content: {
          "application/json": components["schemas"]["UnauthenticatedError"];
        };
      };
      403: {
        content: {
          "application/json": components["schemas"]["ForbiddenError"];
        };
      };
      404: {
        content: {
          "application/json": components["schemas"]["NotFoundError"];
        };
      };
    };
  };
  loginUserCreate: {
    requestBody?: {
      content: {
        "application/json": components["schemas"]["UserCreate"];
        "application/x-www-form-urlencoded": components["schemas"]["UserCreate"];
        "multipart/form-data": components["schemas"]["UserCreate"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Token"];
        };
      };
      400: {
        content: {
          "application/json": components["schemas"]["ValidationError"];
        };
      };
      401: {
        content: {
          "application/json": components["schemas"]["UnauthenticatedError"];
        };
      };
      403: {
        content: {
          "application/json": components["schemas"]["ForbiddenError"];
        };
      };
      404: {
        content: {
          "application/json": components["schemas"]["NotFoundError"];
        };
      };
    };
  };
  claimUnassignedTaskTask: {
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Task"];
        "application/x-www-form-urlencoded": components["schemas"]["Task"];
        "multipart/form-data": components["schemas"]["Task"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Task"];
        };
      };
    };
  };
  keepaliveKeepalive: {
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["Keepalive"];
        "application/x-www-form-urlencoded": components["schemas"]["Keepalive"];
        "multipart/form-data": components["schemas"]["Keepalive"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["Keepalive"];
        };
      };
    };
  };
  markCompletedTaskComplete: {
    parameters: {
      path: {
        id: string;
      };
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["TaskComplete"];
        "application/x-www-form-urlencoded": components["schemas"]["TaskComplete"];
        "multipart/form-data": components["schemas"]["TaskComplete"];
      };
    };
    responses: {
      201: {
        content: {
          "application/json": components["schemas"]["TaskComplete"];
        };
      };
    };
  };
}
