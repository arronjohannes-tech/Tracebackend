import type {FastifyInstance,FastifyRequest} from "fastify";
import type {Pool} from "pg";
import type {AppConfig} from "../config.js";
import {parse,sendData,authOf} from "../http.js";
import {createAuthService,loginSchema,refreshSchema} from "../services/auth-service.js";
export async function registerAuthRoutes(app:FastifyInstance,pool:Pool,config:AppConfig,authenticate:(request:FastifyRequest)=>Promise<void>) {
 const service=createAuthService(pool,config);
 app.post("/api/v1/auth/login",{config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async(request,reply)=>sendData(reply,await service.login(parse(loginSchema,request.body),request)));
 app.post("/api/v1/auth/refresh",{config:{rateLimit:{max:20,timeWindow:"1 minute"}}},async(request,reply)=>sendData(reply,await service.refresh(parse(refreshSchema,request.body).refreshToken)));
 app.post("/api/v1/auth/logout",{preHandler:authenticate},async(request,reply)=>sendData(reply,await service.logout(authOf(request),request,parse(refreshSchema,request.body).refreshToken)));
 app.get("/api/v1/auth/me",{preHandler:authenticate},async(request,reply)=>sendData(reply,await service.me(authOf(request))));
}
