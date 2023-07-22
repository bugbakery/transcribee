/**
 * This file was auto-generated by openapi-typescript.
 * Do not make direct changes to the file.
 */


export interface paths {
  "/": {
    /** Root */
    get: operations["root__get"];
  };
  "/api/v1/config/": {
    /** Get Config */
    get: operations["get_config_api_v1_config__get"];
  };
  "/api/v1/documents/": {
    /** List Documents */
    get: operations["list_documents_api_v1_documents__get"];
    /** Create Document */
    post: operations["create_document_api_v1_documents__post"];
  };
  "/api/v1/documents/{document_id}/": {
    /** Get Document */
    get: operations["get_document_api_v1_documents__document_id___get"];
    /** Delete Document */
    delete: operations["delete_document_api_v1_documents__document_id___delete"];
    /** Update Document */
    patch: operations["update_document_api_v1_documents__document_id___patch"];
  };
  "/api/v1/documents/{document_id}/add_media_file/": {
    /** Add Media File */
    post: operations["add_media_file_api_v1_documents__document_id__add_media_file__post"];
  };
  "/api/v1/documents/{document_id}/set_duration/": {
    /** Set Duration */
    post: operations["set_duration_api_v1_documents__document_id__set_duration__post"];
  };
  "/api/v1/documents/{document_id}/tasks/": {
    /** Get Document Tasks */
    get: operations["get_document_tasks_api_v1_documents__document_id__tasks__get"];
  };
  "/api/v1/tasks/": {
    /** List Tasks */
    get: operations["list_tasks_api_v1_tasks__get"];
    /** Create Task */
    post: operations["create_task_api_v1_tasks__post"];
  };
  "/api/v1/tasks/claim_unassigned_task/": {
    /** Claim Unassigned Task */
    post: operations["claim_unassigned_task_api_v1_tasks_claim_unassigned_task__post"];
  };
  "/api/v1/tasks/{task_id}/keepalive/": {
    /** Keepalive */
    post: operations["keepalive_api_v1_tasks__task_id__keepalive__post"];
  };
  "/api/v1/tasks/{task_id}/mark_completed/": {
    /** Mark Completed */
    post: operations["mark_completed_api_v1_tasks__task_id__mark_completed__post"];
  };
  "/api/v1/tasks/{task_id}/mark_failed/": {
    /** Mark Failed */
    post: operations["mark_failed_api_v1_tasks__task_id__mark_failed__post"];
  };
  "/api/v1/users/change_password/": {
    /** Change Password */
    post: operations["change_password_api_v1_users_change_password__post"];
  };
  "/api/v1/users/create/": {
    /** Create User Req */
    post: operations["create_user_req_api_v1_users_create__post"];
  };
  "/api/v1/users/login/": {
    /** Login */
    post: operations["login_api_v1_users_login__post"];
  };
  "/api/v1/users/logout/": {
    /** Logout */
    post: operations["logout_api_v1_users_logout__post"];
  };
  "/api/v1/users/me/": {
    /** Read User */
    get: operations["read_user_api_v1_users_me__get"];
  };
  "/media/{file}": {
    /** Serve Media */
    get: operations["serve_media_media__file__get"];
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    /** AlignTask */
    AlignTask: {
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      /** Task Parameters */
      task_parameters: Record<string, never>;
      /**
       * Task Type
       * @default ALIGN
       * @enum {string}
       */
      task_type?: "ALIGN";
    };
    /** AssignedTaskResponse */
    AssignedTaskResponse: {
      current_attempt?: components["schemas"]["TaskAttemptResponse"];
      /** Dependencies */
      dependencies: (string)[];
      document: components["schemas"]["Document"];
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      state: components["schemas"]["TaskState"];
      /** Task Parameters */
      task_parameters: Record<string, never>;
      task_type: components["schemas"]["TaskType"];
    };
    /** Body_add_media_file_api_v1_documents__document_id__add_media_file__post */
    Body_add_media_file_api_v1_documents__document_id__add_media_file__post: {
      /**
       * File
       * Format: binary
       */
      file: string;
      /** Tags */
      tags: (string)[];
    };
    /** Body_create_document_api_v1_documents__post */
    Body_create_document_api_v1_documents__post: {
      /**
       * File
       * Format: binary
       */
      file: string;
      /** Language */
      language: string;
      /** Model */
      model: string;
      /** Name */
      name: string;
    };
    /** ChangePasswordRequest */
    ChangePasswordRequest: {
      /** New Password */
      new_password: string;
      /** Old Password */
      old_password: string;
    };
    /** CreateUser */
    CreateUser: {
      /** Password */
      password: string;
      /** Username */
      username: string;
    };
    /** Document */
    Document: {
      /** Changed At */
      changed_at: string;
      /** Created At */
      created_at: string;
      /** Id */
      id: string;
      /** Media Files */
      media_files: (components["schemas"]["DocumentMedia"])[];
      /** Name */
      name: string;
    };
    /** DocumentMedia */
    DocumentMedia: {
      /** Content Type */
      content_type: string;
      /** Tags */
      tags: (string)[];
      /** Url */
      url: string;
    };
    /** DocumentUpdate */
    DocumentUpdate: {
      /** Name */
      name?: string;
    };
    /** HTTPValidationError */
    HTTPValidationError: {
      /** Detail */
      detail?: (components["schemas"]["ValidationError"])[];
    };
    /** KeepaliveBody */
    KeepaliveBody: {
      /** Progress */
      progress?: number;
    };
    /** LoginResponse */
    LoginResponse: {
      /** Token */
      token: string;
    };
    /** ModelConfig */
    ModelConfig: {
      /** Id */
      id: string;
      /** Languages */
      languages: (string)[];
      /** Name */
      name: string;
    };
    /** PublicConfig */
    PublicConfig: {
      /** Models */
      models: {
        [key: string]: components["schemas"]["ModelConfig"] | undefined;
      };
    };
    /** SetDurationRequest */
    SetDurationRequest: {
      /** Duration */
      duration: number;
    };
    /** SpeakerIdentificationTask */
    SpeakerIdentificationTask: {
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      /** Task Parameters */
      task_parameters: Record<string, never>;
      /**
       * Task Type
       * @default IDENTIFY_SPEAKERS
       * @enum {string}
       */
      task_type?: "IDENTIFY_SPEAKERS";
    };
    /** TaskAttemptResponse */
    TaskAttemptResponse: {
      /** Progress */
      progress?: number;
    };
    /** TaskResponse */
    TaskResponse: {
      current_attempt?: components["schemas"]["TaskAttemptResponse"];
      /** Dependencies */
      dependencies: (string)[];
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      /**
       * Id
       * Format: uuid
       */
      id: string;
      state: components["schemas"]["TaskState"];
      /** Task Parameters */
      task_parameters: Record<string, never>;
      task_type: components["schemas"]["TaskType"];
    };
    /**
     * TaskState
     * @description An enumeration.
     * @enum {unknown}
     */
    TaskState: "NEW" | "ASSIGNED" | "COMPLETED" | "FAILED";
    /**
     * TaskType
     * @description An enumeration.
     * @enum {string}
     */
    TaskType: "IDENTIFY_SPEAKERS" | "TRANSCRIBE" | "ALIGN" | "REENCODE";
    /** TranscribeTask */
    TranscribeTask: {
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      task_parameters: components["schemas"]["TranscribeTaskParameters"];
      /**
       * Task Type
       * @default TRANSCRIBE
       * @enum {string}
       */
      task_type?: "TRANSCRIBE";
    };
    /** TranscribeTaskParameters */
    TranscribeTaskParameters: {
      /** Lang */
      lang: string;
      /** Model */
      model: string;
    };
    /** UnknownTask */
    UnknownTask: {
      /**
       * Document Id
       * Format: uuid
       */
      document_id: string;
      /** Task Parameters */
      task_parameters: Record<string, never>;
      /** Task Type */
      task_type: string;
    };
    /** ValidationError */
    ValidationError: {
      /** Location */
      loc: (string | number)[];
      /** Message */
      msg: string;
      /** Error Type */
      type: string;
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

  /** Root */
  root__get: {
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  /** Get Config */
  get_config_api_v1_config__get: {
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["PublicConfig"];
        };
      };
    };
  };
  /** List Documents */
  list_documents_api_v1_documents__get: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": (components["schemas"]["Document"])[];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Create Document */
  create_document_api_v1_documents__post: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    requestBody: {
      content: {
        "multipart/form-data": components["schemas"]["Body_create_document_api_v1_documents__post"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Get Document */
  get_document_api_v1_documents__document_id___get: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Delete Document */
  delete_document_api_v1_documents__document_id___delete: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Update Document */
  update_document_api_v1_documents__document_id___patch: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DocumentUpdate"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Add Media File */
  add_media_file_api_v1_documents__document_id__add_media_file__post: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    requestBody: {
      content: {
        "multipart/form-data": components["schemas"]["Body_add_media_file_api_v1_documents__document_id__add_media_file__post"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Set Duration */
  set_duration_api_v1_documents__document_id__set_duration__post: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["SetDurationRequest"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["Document"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Get Document Tasks */
  get_document_tasks_api_v1_documents__document_id__tasks__get: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        document_id: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": (components["schemas"]["TaskResponse"])[];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** List Tasks */
  list_tasks_api_v1_tasks__get: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": (components["schemas"]["TaskResponse"])[];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Create Task */
  create_task_api_v1_tasks__post: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["SpeakerIdentificationTask"] | components["schemas"]["TranscribeTask"] | components["schemas"]["AlignTask"] | components["schemas"]["UnknownTask"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["TaskResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Claim Unassigned Task */
  claim_unassigned_task_api_v1_tasks_claim_unassigned_task__post: {
    parameters: {
      query: {
        task_type: (components["schemas"]["TaskType"])[];
      };
      header: {
        authorization: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["AssignedTaskResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Keepalive */
  keepalive_api_v1_tasks__task_id__keepalive__post: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        task_id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["KeepaliveBody"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["AssignedTaskResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Mark Completed */
  mark_completed_api_v1_tasks__task_id__mark_completed__post: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        task_id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": Record<string, never>;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["AssignedTaskResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Mark Failed */
  mark_failed_api_v1_tasks__task_id__mark_failed__post: {
    parameters: {
      header: {
        authorization: string;
      };
      path: {
        task_id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": Record<string, never>;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["AssignedTaskResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Change Password */
  change_password_api_v1_users_change_password__post: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ChangePasswordRequest"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Create User Req */
  create_user_req_api_v1_users_create__post: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateUser"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Login */
  login_api_v1_users_login__post: {
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateUser"];
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": components["schemas"]["LoginResponse"];
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Logout */
  logout_api_v1_users_logout__post: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Read User */
  read_user_api_v1_users_me__get: {
    parameters: {
      header: {
        authorization: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
  /** Serve Media */
  serve_media_media__file__get: {
    parameters: {
      query: {
        "X-Transcribee-Signature": string;
      };
      header: {
        range?: Record<string, never>;
      };
      path: {
        file: string;
      };
    };
    responses: {
      /** @description Successful Response */
      200: {
        content: {
          "application/json": Record<string, never>;
        };
      };
      /** @description Validation Error */
      422: {
        content: {
          "application/json": components["schemas"]["HTTPValidationError"];
        };
      };
    };
  };
}
