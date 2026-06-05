// A NestJS controller — routing lives in decorators, not call expressions.
import { Controller, Get, Post, Param } from "@nestjs/common";

@Controller("clinics")
export class ClinicsController {
  @Get(":id")
  findOne(@Param("id") id: string): string {
    return id;
  }

  @Post()
  create(): void {}
}
