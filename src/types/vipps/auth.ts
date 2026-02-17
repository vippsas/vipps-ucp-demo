// Vipps Access Token API - https://developer.vippsmobilepay.com/api/access-token/

export interface VippsAccessTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface VippsAccessTokenError {
  error: string;
  error_description?: string;
}
