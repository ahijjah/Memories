import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('should pass through HttpException with status and message', () => {
    const exception = new BadRequestException('Invalid input');
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    filter.catch(exception, {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as any);

    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Invalid input',
    });
  });

  it('should respond with generic message for unhandled errors', () => {
    const exception = new Error('Database connection failed');
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    filter.catch(exception, {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as any);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
  });
});
