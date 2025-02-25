import { Context } from "@hono/hono";
import { ContentfulStatusCode } from "@hono/hono/utils/http-status";

export interface FormFieldError {
    field: string;
    message: string;
}

export class ApiError extends Error {
    status: ContentfulStatusCode;
    error?: string;
    errors?: FormFieldError[];
    timestamp: Date;

    constructor(status: ContentfulStatusCode) {
        super("ApiError");
        this.status = status;
        this.timestamp = new Date();
    }

    setError(error: string): ApiError {
        this.error = error;
        return this;
    }

    setErrors(errors: FormFieldError[]): ApiError {
        this.errors = errors;
        return this;
    }

    public static internalServerError(): ApiError {
        return new ApiError(500)
            .setError("Internal Server Error");
    }

    private toJSON() {
        return {
            status: this.status,
            error: this.error,
            message: this.message,
            errors: this.errors,  // present for form errors, undefined otherwise
            timestamp: this.timestamp.toISOString(),
        };
    }

    override toString() {
        if (this.errors) {
            return `${this.status}: ${this.errors.map(e => `${e.field}: ${e.message}`).join(", ")}`;
        }
        return `${this.status}: ${this.error || 'No error message'}`;
    }

    toResponse(c: Context) {
        return c.json(this.toJSON(), this.status!);
    }
}
